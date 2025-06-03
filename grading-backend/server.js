// grading-backend/server.js

require('dotenv').config();

console.log('===== ENVIRONMENT VARIABLES =====');
console.log('AWS_ACCESS_KEY_ID:', process.env.AWS_ACCESS_KEY_ID ? '****(loaded)****' : undefined);
console.log('AWS_SECRET_ACCESS_KEY:', process.env.AWS_SECRET_ACCESS_KEY ? '****(loaded)****' : undefined);
console.log('AWS_REGION:', process.env.AWS_REGION);
console.log('STUDENTS_TABLE:', process.env.STUDENTS_TABLE);
console.log('WORKSHEETS_TABLE:', process.env.WORKSHEETS_TABLE);
console.log('=================================');

const express = require('express');
const cors    = require('cors');
const fetch   = require('node-fetch');
const AWS     = require('aws-sdk');

// ─── AWS & DynamoDB 설정 ─────────────────────────────────
AWS.config.update({
  region: process.env.AWS_REGION || 'ap-northeast-2'
});
const ddb = new AWS.DynamoDB.DocumentClient();

// ─── 환경변수 로드 ─────────────────────────────────────────
const WORKSHEETS_TABLE    = process.env.WORKSHEETS_TABLE;   // "Worksheets"
const STUDENTS_TABLE      = process.env.STUDENTS_TABLE;     // "students"
const CLOVA_URL           = process.env.CLOVA_INVOKE_URL;   // Clova OCR URL
const CLOVA_CLIENT_ID     = process.env.CLOVA_CLIENT_ID;
const CLOVA_CLIENT_SECRET = process.env.CLOVA_CLIENT_SECRET;

if (!WORKSHEETS_TABLE)    throw new Error('환경변수 WORKSHEETS_TABLE이 필요합니다.');
if (!STUDENTS_TABLE)      throw new Error('환경변수 STUDENTS_TABLE이 필요합니다.');
if (!CLOVA_URL)           throw new Error('환경변수 CLOVA_INVOKE_URL이 필요합니다.');
if (!CLOVA_CLIENT_ID)     throw new Error('환경변수 CLOVA_CLIENT_ID이 필요합니다.');
if (!CLOVA_CLIENT_SECRET) throw new Error('환경변수 CLOVA_CLIENT_SECRET이 필요합니다.');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ─── POST /grade: 학습지 채점 → DynamoDB에 학생 정보 저장 ─────────────
app.post('/grade', async (req, res) => {
  try {
    const { image: imageBase64 } = req.body;
    if (!imageBase64) {
      return res.status(400).json({ error: '이미지 데이터가 전송되지 않았습니다.' });
    }

    // 1) Clova OCR 호출
    const ocrRes = await fetch(CLOVA_URL, {
      method: 'POST',
      headers: {
        'Content-Type':           'application/json',
        'X-NCP-APIGW-API-KEY-ID': CLOVA_CLIENT_ID,
        'X-OCR-SECRET':           CLOVA_CLIENT_SECRET
      },
      body: JSON.stringify({
        version:   'V2',
        requestId: `req-${Date.now()}`,
        timestamp: Date.now(),
        images: [{ format: 'jpg', name: 'sheet', data: imageBase64 }]
      })
    });
    const ocrJson = await ocrRes.json();
    const fields = ocrJson.images?.[0]?.fields;
    if (!Array.isArray(fields) || fields.length === 0) {
      return res.status(400).json({ error: 'OCR 데이터가 올바르지 않습니다.' });
    }

    // 2) 학습지 코드, 학번, 이름 추출
    const codeField   = fields.find(f => f.name === 'code');
    const numberField = fields.find(f => f.name === 'number');
    const nameField   = fields.find(f => f.name === 'name');
    if (!codeField?.inferText)   return res.status(400).json({ error: '학습지 코드 인식 실패' });
    if (!numberField?.inferText) return res.status(400).json({ error: '학번 인식 실패' });
    if (!nameField?.inferText)   return res.status(400).json({ error: '이름 인식 실패' });

    const worksheetCode = codeField.inferText.trim();
    const studentNo     = numberField.inferText.trim();
    const studentName   = nameField.inferText.trim();

    // 3) 답안 필드(a01, a02, …) 파싱
    const answerFields = fields
      .filter(f => /^a0*\d+$/.test(f.name))
      .map(f => ({
        no:  parseInt(f.name.slice(1), 10),
        ans: Number((f.inferText || '').replace(/[^0-9\-]/g, ''))
      }));
    if (!answerFields.length) {
      return res.status(400).json({ error: '답안 필드를 찾지 못했습니다.' });
    }

    // 4) DynamoDB에서 해당 학습지 코드 정답 조회
    const dbRes = await ddb.query({
      TableName: WORKSHEETS_TABLE,
      KeyConditionExpression: 'worksheet_code = :wc',
      ExpressionAttributeValues: { ':wc': worksheetCode }
    }).promise();
    if (!dbRes.Items || !dbRes.Items.length) {
      return res.status(404).json({ error: `워크시트 "${worksheetCode}"의 정답 데이터를 찾을 수 없습니다.` });
    }

    // 5) 정답·조언 키 맵 생성
    const answerKey = {};
    const adviceKey = {};
    dbRes.Items.forEach(item => {
      answerKey[item.question_number] = item.answer;
      adviceKey[item.question_number] = item.advice || '';
    });

    // 6) 채점 로직
    let correctCount = 0;
    const wrongList = [];
    answerFields.forEach(({ no, ans }) => {
      const correctAns = answerKey[no];
      if (!correctAns || ans === 0 || String(ans) !== String(correctAns)) {
        wrongList.push(no);
      } else {
        correctCount++;
      }
    });
    const total         = Object.keys(answerKey).length;
    const scorePercent  = Math.round((correctCount / total) * 100);
    const scoreText     = `${scorePercent}점 (${correctCount}/${total})`;

    // 7) DynamoDB students 테이블에 저장
    const timestampStr = new Date().toISOString();
    const recordId     = `${studentNo}_${worksheetCode}_${timestampStr}`;
    await ddb.put({
      TableName: STUDENTS_TABLE,
      Item: {
        id:             recordId,
        timestamp:      timestampStr,
        student_no:     studentNo,
        student_name:   studentName,
        worksheet_code: worksheetCode,
        score:          scorePercent
      }
    }).promise();
    console.log(`✅ students 기록됨: ${recordId} → 점수=${scorePercent}`);

    // 8) AI 조언 생성
    let advice = '';
    if (wrongList.length) {
      advice = wrongList
        .map(no => `문제 ${no}번 정답: ${answerKey[no]}, ${adviceKey[no]}`)
        .join('\n');
    }

    // 9) 응답
    return res.json({ wrong: wrongList.join(', '), score: scoreText, advice: advice });

  } catch (err) {
    console.error('💥 /grade 에러:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ─── GET /students: 대시보드용 학생 목록 조회 ─────────────────────
app.get('/students', async (req, res) => {
  try {
    const scanResult = await ddb.scan({ TableName: STUDENTS_TABLE }).promise();
    const studentsArray = scanResult.Items.map(item => ({
      id:             item.id,
      studentNo:      item.student_no,
      name:           item.student_name,
      worksheetCode:  item.worksheet_code,
      score:          item.score,
      timestamp:      item.timestamp
    }));
    return res.json(studentsArray);
  } catch (err) {
    console.error('💥 /students 에러:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ─── 서버 실행 ───────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ server listening on port ${PORT}`));
