// public/js/admin-stats.js

let autoRefreshInterval = null;
let isAutoRefreshEnabled = true; // 기본값: 자동 갱신 활성화
let currentLogFilter = 'user'; // 기본값: 유저만 보기 ('user' | 'all')
let cachedDebugData = null; // 디버그 데이터 캐싱
let cachedGameStats = null; // 게임 통계 데이터 캐싱
let currentGameStatsPeriod = 'daily'; // 기본 기간: 24시간

document.addEventListener('DOMContentLoaded', function() {
  loadStats();
  loadDebugInfo();
  loadServerResources();
  loadGameStats();

  // 자동 갱신 시작 (30초마다)
  startAutoRefresh();

  // 페이지 가시성 변경 감지 (탭 전환 시)
  document.addEventListener('visibilitychange', handleVisibilityChange);

  // 페이지 종료 시 타이머 정리 (메모리 누수 방지)
  window.addEventListener('beforeunload', () => {
    if (autoRefreshInterval) {
      clearInterval(autoRefreshInterval);
      autoRefreshInterval = null;
    }
  });

  // 초기 버튼 상태 설정
  updateAutoRefreshButton();
});

async function loadStats() {
  const loadingState = document.getElementById('loadingState');
  const statsContent = document.getElementById('statsContent');

  try {
    const response = await fetch('/admin/stats', {
      method: 'GET',
      credentials: 'include'
    });

    if (!response.ok) {
      throw new Error('통계를 불러오는데 실패했습니다.');
    }

    const data = await response.json();

    if (data.success) {
      displayStats(data.stats);
      loadingState.classList.add('hidden');
      statsContent.classList.remove('hidden');
    } else {
      throw new Error(data.message || '통계를 불러오는데 실패했습니다.');
    }

  } catch (error) {
    console.error('Stats load error:', error);
    loadingState.innerHTML = `
      <div class="text-center py-20">
        <svg class="w-16 h-16 mx-auto mb-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
        </svg>
        <p class="text-gray-400 text-lg mb-4">${error.message}</p>
        <button onclick="location.reload()" class="bg-blue-500 hover:bg-blue-600 text-white px-6 py-2 rounded-lg transition-colors">
          다시 시도
        </button>
      </div>
    `;
  }
}

async function loadDebugInfo() {
  try {
    const response = await fetch('/admin/stats/debug-ips', {
      method: 'GET',
      credentials: 'include'
    });

    if (!response.ok) {
      throw new Error('디버그 정보를 불러오는데 실패했습니다.');
    }

    const data = await response.json();

    if (data.success) {
      displayDebugInfo(data);
    } else {
      throw new Error(data.message || '디버그 정보를 불러오는데 실패했습니다.');
    }

  } catch (error) {
    console.error('Debug info load error:', error);
    document.getElementById('debugIpList').textContent = '디버그 정보를 불러오는데 실패했습니다.';
    document.getElementById('debugRecentLogs').innerHTML = `
      <tr>
        <td colspan="3" class="text-center text-red-400 py-4">
          디버그 정보를 불러오는데 실패했습니다.
        </td>
      </tr>
    `;
  }
}

function displayStats(stats) {
  // 주요 지표
  document.getElementById('onlineUsers').textContent = stats.online || 0;
  document.getElementById('playingUsers').textContent = stats.playing || 0;
  document.getElementById('dailyVisitors').textContent = stats.daily.visitors || 0;
  document.getElementById('weeklyVisitors').textContent = stats.weekly.visitors || 0;
  document.getElementById('monthlyVisitors').textContent = stats.monthly.visitors || 0;

  // 페이지뷰
  document.getElementById('dailyPageviews').textContent = (stats.daily.pageviews || 0).toLocaleString();
  document.getElementById('weeklyPageviews').textContent = (stats.weekly.pageviews || 0).toLocaleString();
  document.getElementById('monthlyPageviews').textContent = (stats.monthly.pageviews || 0).toLocaleString();

  // 시간대별 통계
  displayHourlyStats(stats.hourlyStats);

  // 일별 통계
  displayDailyStats(stats.dailyStats);
}

function displayHourlyStats(hourlyStats) {
  const table = document.getElementById('hourlyStatsTable');

  if (!hourlyStats || hourlyStats.length === 0) {
    table.innerHTML = `
      <tr>
        <td colspan="3" class="text-center text-gray-500 py-8">
          아직 데이터가 없습니다.
        </td>
      </tr>
    `;
    return;
  }

  // 0-23시까지 모든 시간대 표시 (데이터 없으면 0으로)
  const hours = Array.from({ length: 24 }, (_, i) => i);
  const statsMap = new Map(hourlyStats.map(s => [s.hour, s]));

  table.innerHTML = hours.map(hour => {
    const stat = statsMap.get(hour) || { visitors: 0, pageviews: 0 };
    const isCurrentHour = new Date().getHours() === hour;
    const rowClass = isCurrentHour ? 'bg-blue-900/30' : '';

    return `
      <tr class="border-b border-gray-700 ${rowClass}">
        <td class="p-2 text-gray-300">
          ${String(hour).padStart(2, '0')}:00
          ${isCurrentHour ? '<span class="text-xs text-blue-400 ml-2">(현재)</span>' : ''}
        </td>
        <td class="p-2 text-right text-gray-200">${stat.visitors || 0}명</td>
        <td class="p-2 text-right text-gray-200">${stat.pageviews || 0}회</td>
      </tr>
    `;
  }).join('');
}

function displayDailyStats(dailyStats) {
  const table = document.getElementById('dailyStatsTable');

  if (!dailyStats || dailyStats.length === 0) {
    table.innerHTML = `
      <tr>
        <td colspan="3" class="text-center text-gray-500 py-8">
          아직 데이터가 없습니다.
        </td>
      </tr>
    `;
    return;
  }

  // 최근 7일 채우기 (데이터 없는 날은 0으로)
  const today = new Date();
  const last7Days = Array.from({ length: 7 }, (_, i) => {
    const date = new Date(today);
    date.setDate(date.getDate() - (6 - i));
    date.setHours(0, 0, 0, 0);
    return date;
  });

  const statsMap = new Map(
    dailyStats.map(s => [
      new Date(s.date).toDateString(),
      s
    ])
  );

  table.innerHTML = last7Days.map(date => {
    const dateStr = date.toDateString();
    const stat = statsMap.get(dateStr) || { visitors: 0, pageviews: 0 };
    const isToday = date.toDateString() === today.toDateString();
    const rowClass = isToday ? 'bg-blue-900/30' : '';

    return `
      <tr class="border-b border-gray-700 ${rowClass}">
        <td class="p-2 text-gray-300">
          ${formatDate(date)}
          ${isToday ? '<span class="text-xs text-blue-400 ml-2">(오늘)</span>' : ''}
        </td>
        <td class="p-2 text-right text-gray-200">${stat.visitors || 0}명</td>
        <td class="p-2 text-right text-gray-200">${stat.pageviews || 0}회</td>
      </tr>
    `;
  }).join('');
}

function formatDate(date) {
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const weekdays = ['일', '월', '화', '수', '목', '금', '토'];
  const weekday = weekdays[date.getDay()];

  return `${month}월 ${day}일 (${weekday})`;
}

// 자동 갱신 시작
function startAutoRefresh() {
  if (autoRefreshInterval) {
    clearInterval(autoRefreshInterval);
  }

  if (isAutoRefreshEnabled) {
    autoRefreshInterval = setInterval(() => {
      // 페이지가 보이는 상태일 때만 갱신
      if (!document.hidden) {
        loadStats();
        loadDebugInfo();
        loadServerResources();
        loadGameStats();
      }
    }, 15000); // 15초마다
  }
}

// 자동 갱신 중지
function stopAutoRefresh() {
  if (autoRefreshInterval) {
    clearInterval(autoRefreshInterval);
    autoRefreshInterval = null;
  }
}

// 자동 갱신 토글
function toggleAutoRefresh() {
  isAutoRefreshEnabled = !isAutoRefreshEnabled;

  if (isAutoRefreshEnabled) {
    startAutoRefresh();
    showNotification('자동 갱신 활성화 (15초마다)');
  } else {
    stopAutoRefresh();
    showNotification('자동 갱신 비활성화');
  }

  updateAutoRefreshButton();
}

// 자동 갱신 버튼 UI 업데이트
function updateAutoRefreshButton() {
  const button = document.getElementById('autoRefreshToggle');
  if (button) {
    if (isAutoRefreshEnabled) {
      button.innerHTML = `
        <svg class="w-5 h-5 mr-2 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path>
        </svg>
        자동 갱신 중
      `;
      button.classList.remove('bg-gray-700');
      button.classList.add('bg-green-600');
    } else {
      button.innerHTML = `
        <svg class="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z"></path>
        </svg>
        자동 갱신 정지됨
      `;
      button.classList.remove('bg-green-600');
      button.classList.add('bg-gray-700');
    }
  }
}

// 페이지 가시성 변경 처리
function handleVisibilityChange() {
  if (!document.hidden && isAutoRefreshEnabled) {
    // 페이지가 다시 보이면 즉시 갱신
    loadStats();
    loadDebugInfo();
    loadServerResources();
    loadGameStats();
  }
}

// 알림 표시
function showNotification(message) {
  // 기존 알림 제거
  const existing = document.getElementById('autoRefreshNotification');
  if (existing) {
    existing.remove();
  }

  // 새 알림 생성
  const notification = document.createElement('div');
  notification.id = 'autoRefreshNotification';
  notification.className = 'fixed top-20 right-4 bg-blue-500 text-white px-6 py-3 rounded-lg shadow-lg z-50 transition-opacity duration-300';
  notification.textContent = message;
  document.body.appendChild(notification);

  // 3초 후 제거
  setTimeout(() => {
    notification.style.opacity = '0';
    setTimeout(() => notification.remove(), 300);
  }, 3000);
}

// 서버 리소스 정보 로드
async function loadServerResources() {
  try {
    const response = await fetch('/admin/server-resources', {
      method: 'GET',
      credentials: 'include'
    });

    if (!response.ok) {
      throw new Error('서버 리소스 정보를 불러오는데 실패했습니다.');
    }

    const data = await response.json();

    if (data.success) {
      displayServerResources(data.resources);
    } else {
      throw new Error(data.message || '서버 리소스 정보를 불러오는데 실패했습니다.');
    }
  } catch (error) {
    console.error('Server resources load error:', error);
    document.getElementById('cpuUsage').textContent = 'N/A';
    document.getElementById('memUsage').textContent = 'N/A';
    document.getElementById('diskUsage').textContent = 'N/A';
  }
}

// 서버 리소스 정보 표시
function displayServerResources(resources) {
  // CPU 사용률
  const cpuUsage = resources.cpu.usage || 0;
  document.getElementById('cpuUsage').textContent = cpuUsage.toFixed(1);
  document.getElementById('cpuUsageBar').style.width = `${cpuUsage}%`;
  document.getElementById('cpuCores').textContent = `${resources.cpu.cores || 0} Cores`;

  // CPU 사용률에 따라 색상 변경
  const cpuBar = document.getElementById('cpuUsageBar');
  if (cpuUsage > 80) {
    cpuBar.classList.remove('bg-blue-500', 'bg-yellow-500');
    cpuBar.classList.add('bg-red-500');
  } else if (cpuUsage > 60) {
    cpuBar.classList.remove('bg-blue-500', 'bg-red-500');
    cpuBar.classList.add('bg-yellow-500');
  } else {
    cpuBar.classList.remove('bg-yellow-500', 'bg-red-500');
    cpuBar.classList.add('bg-blue-500');
  }

  // 메모리 사용률
  const memUsage = resources.memory.usagePercent || 0;
  const memTotal = (resources.memory.total / (1024**3)).toFixed(2); // GB
  const memUsed = (resources.memory.used / (1024**3)).toFixed(2); // GB
  document.getElementById('memUsage').textContent = memUsage.toFixed(1);
  document.getElementById('memUsageBar').style.width = `${memUsage}%`;
  document.getElementById('memInfo').textContent = `${memUsed} GB / ${memTotal} GB`;

  // 메모리 사용률에 따라 색상 변경
  const memBar = document.getElementById('memUsageBar');
  if (memUsage > 80) {
    memBar.classList.remove('bg-green-500', 'bg-yellow-500');
    memBar.classList.add('bg-red-500');
  } else if (memUsage > 60) {
    memBar.classList.remove('bg-green-500', 'bg-red-500');
    memBar.classList.add('bg-yellow-500');
  } else {
    memBar.classList.remove('bg-yellow-500', 'bg-red-500');
    memBar.classList.add('bg-green-500');
  }

  // 디스크 사용률
  const diskUsage = resources.disk.usagePercent || 0;
  const diskTotal = (resources.disk.size / (1024**3)).toFixed(2); // GB
  const diskUsed = (resources.disk.used / (1024**3)).toFixed(2); // GB
  document.getElementById('diskUsage').textContent = diskUsage.toFixed(1);
  document.getElementById('diskUsageBar').style.width = `${diskUsage}%`;
  document.getElementById('diskInfo').textContent = `${diskUsed} GB / ${diskTotal} GB`;

  // 디스크 사용률에 따라 색상 변경
  const diskBar = document.getElementById('diskUsageBar');
  if (diskUsage > 80) {
    diskBar.classList.remove('bg-orange-500', 'bg-yellow-500');
    diskBar.classList.add('bg-red-500');
  } else if (diskUsage > 60) {
    diskBar.classList.remove('bg-orange-500', 'bg-red-500');
    diskBar.classList.add('bg-yellow-500');
  } else {
    diskBar.classList.remove('bg-yellow-500', 'bg-red-500');
    diskBar.classList.add('bg-orange-500');
  }

  // 서버 정보
  document.getElementById('osInfo').textContent = `${resources.os.distro || resources.os.platform || 'Unknown'}`;
  document.getElementById('archInfo').textContent = resources.os.arch || 'Unknown';

  // 업타임 (초 -> 시간:분:초)
  const uptime = resources.uptime || 0;
  const hours = Math.floor(uptime / 3600);
  const minutes = Math.floor((uptime % 3600) / 60);
  const seconds = Math.floor(uptime % 60);
  document.getElementById('uptimeInfo').textContent = `${hours}h ${minutes}m ${seconds}s`;

  // 마지막 갱신 시간
  const now = new Date();
  document.getElementById('lastUpdateInfo').textContent = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
}

// 전역 함수로 등록
window.toggleAutoRefresh = toggleAutoRefresh;
window.setLogFilter = setLogFilter;
window.switchGameStatsPeriod = switchGameStatsPeriod;

function displayDebugInfo(data) {
  // 데이터 캐싱 (필터 변경 시 재사용)
  cachedDebugData = data;

  // 고유 IP 개수 표시 (실제 사용자 vs 전체)
  const countText = `${data.uniqueIpCountReal || 0} 명 (봇 제외)`;
  const allCountText = `전체 ${data.uniqueIpCount || 0}명 (봇 포함)`;

  document.getElementById('debugUniqueIpCount').innerHTML = `
    ${countText}
    <div class="text-sm font-normal text-gray-400 mt-1">${allCountText}</div>
  `;

  // 고유 IP 목록 표시 (실제 사용자만)
  const ipListEl = document.getElementById('debugIpList');
  if (data.uniqueIpsReal && data.uniqueIpsReal.length > 0) {
    ipListEl.innerHTML = `
      <div class="text-green-400 text-xs mb-2">✓ 실제 사용자 IP (${data.uniqueIpsReal.length}개)</div>
      ${data.uniqueIpsReal.map((ip, index) =>
        `<div class="mb-1 text-green-300">${index + 1}. ${ip}</div>`
      ).join('')}
      ${data.uniqueIps.length > data.uniqueIpsReal.length ? `
        <div class="text-red-400 text-xs mt-3 mb-2">⚠ 봇 IP (${data.uniqueIps.length - data.uniqueIpsReal.length}개)</div>
        ${data.uniqueIps.filter(ip => !data.uniqueIpsReal.includes(ip)).map((ip, index) =>
          `<div class="mb-1 text-red-300">${index + 1}. ${ip}</div>`
        ).join('')}
      ` : ''}
    `;
  } else {
    ipListEl.textContent = '수집된 실제 사용자 IP가 없습니다.';
  }

  // 최근 로그 표시 (필터 적용)
  renderRecentLogs(data.recentLogs);

  // 필터 버튼 초기 상태 설정
  updateLogFilterButtons();
}

// 최근 로그 렌더링 (필터 적용)
function renderRecentLogs(logs) {
  const logsTable = document.getElementById('debugRecentLogs');

  if (!logs || logs.length === 0) {
    logsTable.innerHTML = `
      <tr>
        <td colspan="3" class="text-center text-gray-500 py-8">
          수집된 로그가 없습니다.
        </td>
      </tr>
    `;
    return;
  }

  // 필터 적용
  const filteredLogs = currentLogFilter === 'user'
    ? logs.filter(log => !log.isBot)
    : logs;

  if (filteredLogs.length === 0) {
    logsTable.innerHTML = `
      <tr>
        <td colspan="3" class="text-center text-gray-500 py-8">
          ${currentLogFilter === 'user' ? '유저 로그가 없습니다.' : '수집된 로그가 없습니다.'}
        </td>
      </tr>
    `;
    return;
  }

  logsTable.innerHTML = filteredLogs.map(log => {
    const date = new Date(log.timestamp);
    const timeStr = `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`;

    const botBadge = log.isBot ? '<span class="text-xs bg-red-500/30 text-red-300 px-2 py-0.5 rounded ml-2">BOT</span>' : '<span class="text-xs bg-green-500/30 text-green-300 px-2 py-0.5 rounded ml-2">USER</span>';
    const rowClass = log.isBot ? 'bg-red-900/10' : '';

    return `
      <tr class="border-b border-gray-700 ${rowClass}">
        <td class="p-2 text-gray-300">${log.ip}${botBadge}</td>
        <td class="p-2 text-gray-300">${log.path}</td>
        <td class="p-2 text-gray-400">${timeStr}</td>
      </tr>
    `;
  }).join('');
}

// 로그 필터 변경
function setLogFilter(filter) {
  currentLogFilter = filter;
  updateLogFilterButtons();

  // 캐시된 데이터로 로그 재렌더링
  if (cachedDebugData && cachedDebugData.recentLogs) {
    renderRecentLogs(cachedDebugData.recentLogs);
  }
}

// 로그 필터 버튼 상태 업데이트
function updateLogFilterButtons() {
  const userOnlyBtn = document.getElementById('filterUserOnly');
  const allBtn = document.getElementById('filterAll');

  if (userOnlyBtn && allBtn) {
    if (currentLogFilter === 'user') {
      userOnlyBtn.classList.remove('bg-gray-600', 'hover:bg-gray-500');
      userOnlyBtn.classList.add('bg-green-600', 'hover:bg-green-700');
      allBtn.classList.remove('bg-blue-600', 'hover:bg-blue-700');
      allBtn.classList.add('bg-gray-600', 'hover:bg-gray-500');
    } else {
      userOnlyBtn.classList.remove('bg-green-600', 'hover:bg-green-700');
      userOnlyBtn.classList.add('bg-gray-600', 'hover:bg-gray-500');
      allBtn.classList.remove('bg-gray-600', 'hover:bg-gray-500');
      allBtn.classList.add('bg-blue-600', 'hover:bg-blue-700');
    }
  }
}

// ========== 게임 활동 통계 ==========

async function loadGameStats() {
  try {
    const response = await fetch('/admin/stats/game', {
      method: 'GET',
      credentials: 'include'
    });

    if (!response.ok) {
      throw new Error('게임 통계를 불러오는데 실패했습니다.');
    }

    const data = await response.json();

    if (data.success) {
      cachedGameStats = data.gameStats;
      displayGameStats();
    }
  } catch (error) {
    console.error('Game stats load error:', error);
  }
}

function displayGameStats() {
  if (!cachedGameStats) return;

  const stats = cachedGameStats[currentGameStatsPeriod];
  if (!stats) return;

  document.getElementById('gameSessionsCreated').textContent = (stats.sessionsCreated || 0).toLocaleString();
  document.getElementById('gameGamesCompleted').textContent = (stats.gamesCompleted || 0).toLocaleString();
  document.getElementById('gameUniquePlayers').textContent = (stats.uniquePlayers || 0).toLocaleString();
}

function switchGameStatsPeriod(period) {
  currentGameStatsPeriod = period;

  // 탭 버튼 스타일 업데이트
  const tabs = document.querySelectorAll('.game-stats-tab');
  tabs.forEach(tab => {
    if (tab.dataset.period === period) {
      tab.classList.remove('bg-gray-700', 'text-gray-300');
      tab.classList.add('bg-blue-600', 'text-white');
    } else {
      tab.classList.remove('bg-blue-600', 'text-white');
      tab.classList.add('bg-gray-700', 'text-gray-300');
    }
  });

  // 캐시된 데이터로 즉시 재렌더링
  displayGameStats();
}
