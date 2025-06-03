// frontend/app.js

function DashboardPage() {
  const { useEffect, useState } = React;
  const [students, setStudents] = useState([]);
  const [search, setSearch] = useState('');

  useEffect(() => {
    // Replit 백엔드 URL에 맞춰서 변경하세요
    fetch('https://68744ad1-8dba-41d6-9c56-4a5aa4062eb2-00-2w8umvmvho639.sisko.replit.dev/')
      .then((res) => res.json())
      .then((data) => setStudents(data))
      .catch((err) => console.error('Error fetching students:', err));
  }, []);

  // 이름으로 필터링
  const filtered = students.filter((s) =>
    s.name.toLowerCase().includes(search.toLowerCase())
  );

  // 통계 계산
  const total = filtered.length;
  const sumScores = filtered.reduce((sum, s) => sum + Number(s.score), 0);
  const avgScore = total ? (sumScores / total).toFixed(1) : '0.0';
  const maxScore = total ? Math.max(...filtered.map((s) => Number(s.score))) : 0;
  const minScore = total ? Math.min(...filtered.map((s) => Number(s.score))) : 0;

  return (
    <div className="min-h-screen bg-gray-100 p-8">
      <h1 className="text-3xl font-bold mb-6 text-center">
        학생 채점 결과 대시보드
      </h1>

      {/* 통계 카드 */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className="p-4 bg-white rounded-2xl shadow">
          <p className="text-sm text-gray-500">총 학생 수</p>
          <p className="text-2xl font-semibold">{total}</p>
        </div>
        <div className="p-4 bg-white rounded-2xl shadow">
          <p className="text-sm text-gray-500">평균 점수</p>
          <p className="text-2xl font-semibold">{avgScore}</p>
        </div>
        <div className="p-4 bg-white rounded-2xl shadow">
          <p className="text-sm text-gray-500">최고/최저 점수</p>
          <p className="text-2xl font-semibold">
            {maxScore} / {minScore}
          </p>
        </div>
      </div>

      {/* 검색 바 */}
      <div className="mb-4 max-w-sm mx-auto">
        <input
          type="text"
          placeholder="학생 이름 검색..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-300"
        />
      </div>

      {/* 학생 테이블 */}
      <div className="overflow-x-auto">
        <table className="min-w-full bg-white rounded-2xl shadow-lg">
          <thead className="bg-indigo-600 text-white">
            <tr>
              <th className="px-6 py-3 text-left">학생 이름</th>
              <th className="px-6 py-3 text-left">학습지 코드</th>
              <th className="px-6 py-3 text-left">점수</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((s) => (
              <tr key={s.id} className="border-b hover:bg-gray-50">
                <td className="px-6 py-4">{s.name}</td>
                <td className="px-6 py-4">{s.worksheetCode}</td>
                <td className="px-6 py-4 font-semibold">{s.score}</td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td
                  colSpan={3}
                  className="px-6 py-4 text-center text-gray-500"
                >
                  검색 결과가 없습니다.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ReactDOM을 이용해 <DashboardPage />를 #root에 렌더링
ReactDOM.createRoot(document.getElementById('root')).render(<DashboardPage />);
