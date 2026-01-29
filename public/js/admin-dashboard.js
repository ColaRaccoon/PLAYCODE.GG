// admin-dashboard.js
import { renderNavbar, highlightCurrentPage } from './navbar.js';
import { uploadToS3WithPresignedUrl } from './quiz-init-modal.js';
import { renderFooter } from './footer.js';

let allQuizzes = [];
let currentPage = 1;
let isLoading = false;
let hasMore = true;
let currentUser = null; // 현재 사용자 정보 저장
let currentSearchTerm = ''; // 현재 검색어
let currentFilterStatus = 'all'; // 현재 필터 상태
let imageCache = new Map(); // 이미지 캐시 (quizId -> images)
let autoRefreshInterval = null;
let isAutoRefreshEnabled = true; // 기본값: 자동 갱신 활성화

// 퀴즈 수정 관련 변수
let currentEditQuizId = null;
let editThumbnailFile = null; // File 객체 저장
let editThumbnailUrl = null; // S3 URL 또는 기존 URL 저장

// 토큰 인증이 포함된 fetch 함수
async function fetchWithAuth(url, options = {}) {
    options.credentials = 'include';
    let response = await fetch(url, options);

    if (response.status === 401) {
        const refreshResponse = await fetch('/auth/refresh', {
            method: 'POST',
            credentials: 'include'
        });

        if (refreshResponse.ok) {
            response = await fetch(url, options);
        } else {
            alert('세션이 만료되었습니다. 다시 로그인해주세요.');
            window.location.href = '/login';
            return;
        }
    }
    return response;
}

// 페이지 초기화
async function initializePage() {
  try {
    // 네비바 렌더링
    const user = await renderNavbar();
    highlightCurrentPage();

    // 푸터 렌더링
    await renderFooter();

    if (!user) {
      alert('로그인이 필요합니다.');
      window.location.href = '/login';
      return;
    }

    // 관리자 권한 체크는 서버에서 하지만, 클라이언트에서도 확인
    if (user.role !== 'admin' && user.role !== 'superadmin') {
      alert('관리자 권한이 필요합니다.');
      window.location.href = '/';
      return;
    }

    // 현재 사용자 정보 저장
    currentUser = user;

    // 퀴즈 목록 로드
    await loadQuizzes();

    // 검색 이벤트 리스너 설정
    setupSearchListeners();

    // 무한 스크롤 이벤트 리스너 추가
    window.addEventListener('scroll', handleScroll);

    // 자동 갱신 시작 (15초마다)
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
  } catch (error) {
    console.error('페이지 초기화 실패:', error);
    alert('페이지 초기화 중 오류가 발생했습니다.');
  }
}

// 퀴즈 목록 로드
async function loadQuizzes(reset = false) {
  if (isLoading || (!hasMore && !reset)) return;

  try {
    isLoading = true;

    // 리셋 시 초기화
    if (reset) {
      currentPage = 1;
      allQuizzes = [];
      hasMore = true;
    }

    // 로딩 인디케이터 표시
    if (currentPage === 1) {
      document.getElementById('loadingState').classList.remove('hidden');
      document.getElementById('quizTableContainer').classList.add('hidden');
    } else {
      showLoadMoreIndicator();
    }

    // 검색어가 있으면 검색 API, 없으면 일반 목록 API
    let url;
    if (currentSearchTerm) {
      url = `/admin/quizzes/search?q=${encodeURIComponent(currentSearchTerm)}&page=${currentPage}&limit=10&status=${currentFilterStatus}`;
    } else {
      url = `/admin/quizzes?page=${currentPage}&limit=10&status=${currentFilterStatus}`;
    }

    const response = await fetchWithAuth(url);

    if (!response.ok) {
      if (response.status === 403) {
        alert('관리자 권한이 필요합니다.');
        window.location.href = '/';
        return;
      }
      throw new Error('퀴즈 목록 로드 실패');
    }

    const data = await response.json();

    // 새로운 퀴즈 추가
    allQuizzes = [...allQuizzes, ...data.quizzes];
    hasMore = data.pagination.hasMore;

    // 신고 카운트 및 문의 카운트 업데이트 (첫 페이지만)
    if (currentPage === 1) {
      updateReportCount();
      updateContactCount();
    }

    // 테이블 렌더링
    renderQuizTable(allQuizzes);

    // 로딩 상태 숨기고 테이블 표시
    document.getElementById('loadingState').classList.add('hidden');
    document.getElementById('quizTableContainer').classList.remove('hidden');
    hideLoadMoreIndicator();

    // 다음 페이지 준비
    currentPage++;
  } catch (err) {
    console.error('퀴즈 로드 에러:', err);
    if (currentPage === 1) {
      document.getElementById('loadingState').innerHTML = `
        <p class="text-red-400">퀴즈 목록을 불러오는데 실패했습니다.</p>
        <button onclick="location.reload()" class="mt-4 bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-lg">
          다시 시도
        </button>
      `;
    }
    hideLoadMoreIndicator();
  } finally {
    isLoading = false;
  }
}

// 신고 카운트 업데이트
async function updateReportCount() {
  try {
    const response = await fetchWithAuth('/admin/reported-quizzes?page=1&limit=1');

    if (response.ok) {
      const data = await response.json();
      const reportCount = data.pagination.totalCount || 0;
      document.getElementById('reportCount').textContent = reportCount;
    } else {
      document.getElementById('reportCount').textContent = '0';
    }
  } catch (err) {
    console.error('Report count load error:', err);
    document.getElementById('reportCount').textContent = '0';
  }
}

// 문의 카운트 업데이트
async function updateContactCount() {
  try {
    const response = await fetchWithAuth('/admin/contacts?page=1&limit=1&status=pending');

    if (response.ok) {
      const data = await response.json();
      const contactCount = data.pagination.totalCount || 0;
      document.getElementById('contactCount').textContent = contactCount;
    } else {
      document.getElementById('contactCount').textContent = '0';
    }
  } catch (err) {
    console.error('Contact count load error:', err);
    document.getElementById('contactCount').textContent = '0';
  }
}

// 미리보기 툴팁 타이머 관리
let tooltipHideTimer = null;

// 빈 툴팁 생성 (호버 시 이미지 로드)
function createEmptyTooltip() {
  return `
    <div class="image-preview-tooltip absolute left-full ml-2 top-0 hidden bg-gray-900 border border-gray-700 rounded-lg p-3 shadow-xl z-50 max-h-96 overflow-y-auto" style="min-width: 150px;">
      <div class="flex items-center justify-center py-4">
        <div class="animate-spin rounded-full h-6 w-6 border-b-2 border-white"></div>
      </div>
    </div>
  `;
}

// 이미지 로드 및 툴팁 업데이트
async function loadQuizImages(quizId, tooltip) {
  // 캐시에 있으면 바로 표시
  if (imageCache.has(quizId)) {
    updateTooltipWithImages(tooltip, imageCache.get(quizId));
    return;
  }

  try {
    const response = await fetchWithAuth(`/admin/quizzes/${quizId}/images`);

    if (!response.ok) {
      throw new Error('이미지 로드 실패');
    }

    const data = await response.json();

    if (data.success) {
      // 캐시에 저장
      imageCache.set(quizId, data.images);
      // 툴팁 업데이트
      updateTooltipWithImages(tooltip, data.images);
    } else {
      tooltip.innerHTML = '<div class="text-xs text-gray-400 p-2">이미지 로드 실패</div>';
    }
  } catch (error) {
    console.error('Quiz images load error:', error);
    tooltip.innerHTML = '<div class="text-xs text-gray-400 p-2">이미지 로드 실패</div>';
  }
}

// 툴팁에 이미지 표시
function updateTooltipWithImages(tooltip, images) {
  if (!images || images.length === 0) {
    tooltip.innerHTML = '<div class="text-xs text-gray-400 p-2 whitespace-nowrap">이미지 없음</div>';
    return;
  }

  const imageItems = images.map((img, idx) => {
    let html = '';
    if (img.imageBase64) {
      html += `<div class="mb-2"><div class="text-xs text-gray-400 mb-1">문제 ${img.order || idx + 1}</div><img src="${img.imageBase64}" class="w-32 h-24 object-cover rounded"></div>`;
    }
    if (img.answerImageBase64) {
      html += `<div class="mb-2"><div class="text-xs text-gray-400 mb-1">정답 ${img.order || idx + 1}</div><img src="${img.answerImageBase64}" class="w-32 h-24 object-cover rounded"></div>`;
    }
    return html;
  }).join('');

  tooltip.innerHTML = `
    <div class="text-xs font-semibold text-gray-300 mb-2">문제 이미지 (${images.length})</div>
    ${imageItems}
  `;
}

// 툴팁 표시
function showTooltip(tooltip) {
  clearTimeout(tooltipHideTimer);
  tooltip.classList.remove('hidden');
}

// 툴팁 숨기기 (딜레이 포함)
function hideTooltip(tooltip, delay = 300) {
  clearTimeout(tooltipHideTimer);
  tooltipHideTimer = setTimeout(() => {
    tooltip.classList.add('hidden');
  }, delay);
}

// 툴팁 이벤트 설정
function setupTooltipEvents(thumbnailElement, tooltip, quizId) {
  let imagesLoaded = false;

  // 썸네일에 마우스 올리면 표시
  thumbnailElement.addEventListener('mouseenter', () => {
    showTooltip(tooltip);

    // 이미지가 아직 로드되지 않았으면 로드
    if (!imagesLoaded) {
      loadQuizImages(quizId, tooltip);
      imagesLoaded = true;
    }
  });

  // 썸네일에서 마우스 벗어나면 딜레이 후 숨김
  thumbnailElement.addEventListener('mouseleave', () => {
    hideTooltip(tooltip);
  });

  // 툴팁에 마우스 올리면 계속 표시
  tooltip.addEventListener('mouseenter', () => {
    showTooltip(tooltip);
  });

  // 툴팁에서 마우스 벗어나면 딜레이 후 숨김
  tooltip.addEventListener('mouseleave', () => {
    hideTooltip(tooltip);
  });
}

// 퀴즈 테이블 렌더링
function renderQuizTable(quizzes) {
  const tbody = document.getElementById('quizList');
  tbody.innerHTML = '';

  if (quizzes.length === 0) {
    document.getElementById('quizTableContainer').classList.add('hidden');
    document.getElementById('emptyState').classList.remove('hidden');
    return;
  }

  document.getElementById('quizTableContainer').classList.remove('hidden');
  document.getElementById('emptyState').classList.add('hidden');

  quizzes.forEach(quiz => {
    const tr = document.createElement('tr');
    tr.className = 'border-b border-gray-700 hover:bg-gray-800/50 transition-colors cursor-pointer';
    tr.onclick = (e) => {
      // 버튼 클릭 시에는 이동하지 않음
      if (e.target.tagName === 'BUTTON' || e.target.closest('button')) {
        return;
      }
      window.location.href = `/quiz/edit?quizId=${quiz._id}`;
    };

    const createdDate = new Date(quiz.createdAt).toLocaleDateString('ko-KR');
    const isSeized = !!quiz.originalCreatorId; // 압수 여부 확인

    tr.innerHTML = `
      <td class="p-3">
        <div class="flex items-center gap-2">
          <div class="relative group">
            ${quiz.titleImageBase64 ? `
              <img src="${quiz.titleImageBase64}" alt="썸네일" class="w-12 h-12 rounded object-cover cursor-pointer" onclick="event.stopPropagation(); openEditModal('${quiz._id}')">
            ` : `
              <div class="w-12 h-12 rounded bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-bold cursor-pointer" onclick="event.stopPropagation(); openEditModal('${quiz._id}')">
                Q
              </div>
            `}
            ${createEmptyTooltip()}
          </div>
          <div>
            <div class="font-medium text-white">${quiz.title}</div>
            <div class="text-xs text-gray-400">${quiz.description || '설명 없음'}</div>
          </div>
        </div>
      </td>
      <td class="p-3">
        <div
          class="text-white cursor-pointer hover:text-blue-400 transition-colors"
          onclick="event.stopPropagation(); changeUserNickname('${quiz.creatorId}', '${quiz.creator.nickname.replace(/'/g, "\\'")}')"
          title="클릭하여 닉네임 수정"
        >
          ${quiz.creator.nickname}
        </div>
        <div class="text-xs text-gray-400">${quiz.creator.email}</div>
      </td>
      <td class="p-3 text-gray-300 whitespace-nowrap">${quiz.questionCount || 0}개</td>
      <td class="p-3 whitespace-nowrap">
        ${isSeized ? `
          <div class="space-y-1">
            <span class="px-2 py-1 rounded text-xs font-semibold bg-orange-500/20 text-orange-400 border border-orange-500">
              압수
            </span>
            ${quiz.seizedBy ? `
              <div class="text-xs text-gray-300 mt-1">
                <span class="text-gray-500">압수자:</span> ${quiz.seizedBy.nickname}
              </div>
            ` : ''}
            ${quiz.seizedReason ? `
              <div class="text-xs text-gray-300 mt-1">
                <span class="text-gray-500">사유:</span> ${quiz.seizedReason}
              </div>
            ` : ''}
          </div>
        ` : `
          <span class="px-2 py-1 rounded text-xs font-semibold bg-gray-500/20 text-gray-400 border border-gray-500">
            정상
          </span>
        `}
      </td>
      <td class="p-3 text-gray-300 text-sm whitespace-nowrap">${createdDate}</td>
      <td class="p-3">
        <div class="flex flex-col gap-1 items-center">
          ${!isSeized ? `
            <button
              onclick="toggleVisibility('${quiz._id}', ${!quiz.isComplete})"
              class="border border-gray-600 hover:bg-blue-400 text-white px-3 py-1 rounded-lg shadow transition-colors text-xs whitespace-nowrap"
            >
              ${quiz.isComplete ? '비공개' : '공개'}
            </button>
            <button
              onclick="seizeQuiz('${quiz._id}', '${quiz.title.replace(/'/g, "\\'")}')"
              class="border border-gray-600 hover:bg-blue-400 text-white px-3 py-1 rounded-lg shadow transition-colors text-xs whitespace-nowrap"
            >
              압수
            </button>
            <button
              onclick="suspendUserFromDashboard('${quiz.creatorId}', '${quiz.creator.nickname.replace(/'/g, "\\'")}')"
              class="border border-gray-600 hover:bg-yellow-400 text-white px-3 py-1 rounded-lg shadow transition-colors text-xs whitespace-nowrap"
            >
              정지
            </button>
          ` : `
            <button
              onclick="restoreQuiz('${quiz._id}', '${quiz.title.replace(/'/g, "\\'")}')"
              class="border border-gray-600 hover:bg-blue-400 text-white px-3 py-1 rounded-lg shadow transition-colors text-xs whitespace-nowrap"
            >
              복구
            </button>
            ${currentUser && currentUser.role === 'superadmin' ? `
              <button
                onclick="deleteQuiz('${quiz._id}', '${quiz.title.replace(/'/g, "\\'")}')"
                class="border border-gray-600 hover:bg-blue-400 text-white px-3 py-1 rounded-lg shadow transition-colors text-xs whitespace-nowrap"
              >
                영구삭제
              </button>
            ` : ''}
          `}
        </div>
      </td>
    `;

    tbody.appendChild(tr);

    // 툴팁 이벤트 설정
    const thumbnailContainer = tr.querySelector('.relative.group');
    const tooltip = tr.querySelector('.image-preview-tooltip');
    if (thumbnailContainer && tooltip) {
      // 썸네일 이미지 또는 기본 아이콘 요소 찾기
      const thumbnailElement = thumbnailContainer.querySelector('img, div.w-12');
      if (thumbnailElement) {
        setupTooltipEvents(thumbnailElement, tooltip, quiz._id);
      }
    }
  });
}

// 검색 실행 함수
async function searchQuizzes() {
  const searchInput = document.getElementById('searchInput');
  currentSearchTerm = searchInput.value.trim();
  currentFilterStatus = document.getElementById('filterStatus').value;

  currentPage = 1;
  hasMore = true;
  allQuizzes = [];

  await loadQuizzes();
}

// 검색 초기화 (상태 필터 변경 시)
async function changeFilterStatus() {
  currentFilterStatus = document.getElementById('filterStatus').value;

  // 필터가 변경되면 항상 다시 로드 (검색어 유무 관계없이)
  currentPage = 1;
  hasMore = true;
  allQuizzes = [];
  await loadQuizzes();
}

// 검색 이벤트 리스너 설정
function setupSearchListeners() {
  const searchBtn = document.getElementById('searchBtn');
  const searchInput = document.getElementById('searchInput');
  const filterStatus = document.getElementById('filterStatus');

  // 검색 버튼 클릭
  if (searchBtn) {
    searchBtn.addEventListener('click', searchQuizzes);
  }

  // 엔터 키로 검색
  if (searchInput) {
    searchInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        searchQuizzes();
      }
    });
  }

  // 상태 필터 변경
  if (filterStatus) {
    filterStatus.addEventListener('change', changeFilterStatus);
  }
}

// 퀴즈 공개/비공개 토글
async function toggleVisibility(quizId, isComplete) {
  const action = isComplete ? '공개' : '비공개';

  if (!confirm(`이 퀴즈를 ${action} 처리하시겠습니까?`)) {
    return;
  }

  try {
    const response = await fetchWithAuth(`/admin/quizzes/${quizId}/visibility`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isComplete })
    });

    const data = await response.json();

    if (response.ok) {
      alert(data.message);
      await loadQuizzes(true); // 목록 새로고침 (리셋)
    } else {
      alert(data.message || '처리 중 오류가 발생했습니다.');
    }
  } catch (err) {
    console.error('Visibility toggle error:', err);
    alert('처리 중 오류가 발생했습니다.');
  }
}

// 퀴즈 압수
async function seizeQuiz(quizId, title) {
  const reason = prompt(`"${title}" 퀴즈를 압수하시겠습니까?\n\n압수 사유를 입력하세요 (선택사항):`);

  // 취소 버튼을 누르면 null이 반환됨
  if (reason === null) {
    return;
  }

  try {
    const response = await fetchWithAuth(`/admin/quizzes/${quizId}/seize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: reason || '관리자 조치' })
    });

    const data = await response.json();

    if (response.ok) {
      alert(data.message);
      await loadQuizzes(true); // 목록 새로고침 (리셋)
    } else {
      alert(data.message || '압수 처리 중 오류가 발생했습니다.');
    }
  } catch (err) {
    console.error('Quiz seize error:', err);
    alert('압수 처리 중 오류가 발생했습니다.');
  }
}

// 퀴즈 복구
async function restoreQuiz(quizId, title) {
  if (!confirm(`"${title}" 퀴즈를 원본 작성자에게 복구하시겠습니까?`)) {
    return;
  }

  try {
    const response = await fetchWithAuth(`/admin/quizzes/${quizId}/restore`, {
      method: 'POST'
    });

    const data = await response.json();

    if (response.ok) {
      alert(data.message);
      await loadQuizzes(true); // 목록 새로고침 (리셋)
    } else {
      alert(data.message || '복구 처리 중 오류가 발생했습니다.');
    }
  } catch (err) {
    console.error('Quiz restore error:', err);
    alert('복구 처리 중 오류가 발생했습니다.');
  }
}

// 퀴즈 영구 삭제 (superadmin만 가능)
async function deleteQuiz(quizId, title) {
  if (!confirm(`"${title}" 퀴즈를 영구 삭제하시겠습니까?\n\n⚠️ 이 작업은 되돌릴 수 없습니다.`)) {
    return;
  }

  try {
    const response = await fetchWithAuth(`/admin/quizzes/${quizId}`, {
      method: 'DELETE'
    });

    const data = await response.json();

    if (response.ok) {
      alert(data.message);
      await loadQuizzes(true); // 목록 새로고침 (리셋)
    } else {
      alert(data.message || '삭제 중 오류가 발생했습니다.');
    }
  } catch (err) {
    console.error('Quiz delete error:', err);
    alert('삭제 중 오류가 발생했습니다.');
  }
}

// 무한 스크롤 핸들러
function handleScroll() {
  // 페이지 하단에 도달했는지 확인
  const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
  const scrollHeight = document.documentElement.scrollHeight;
  const clientHeight = document.documentElement.clientHeight;

  // 하단에서 200px 정도 남았을 때 로드
  if (scrollTop + clientHeight >= scrollHeight - 200) {
    loadQuizzes();
  }
}

// 로딩 인디케이터 표시
function showLoadMoreIndicator() {
  let indicator = document.getElementById('loadMoreIndicator');
  if (!indicator) {
    indicator = document.createElement('div');
    indicator.id = 'loadMoreIndicator';
    indicator.className = 'text-center py-8';
    indicator.innerHTML = `
      <div class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
      <p class="text-gray-400 mt-2">추가 퀴즈를 불러오는 중...</p>
    `;
    document.getElementById('quizTableContainer').appendChild(indicator);
  }
  indicator.classList.remove('hidden');
}

// 로딩 인디케이터 숨기기
function hideLoadMoreIndicator() {
  const indicator = document.getElementById('loadMoreIndicator');
  if (indicator) {
    indicator.classList.add('hidden');
  }
}

// 자동 갱신 시작 (신고 카운트 + 퀴즈 목록 갱신)
function startAutoRefresh() {
  if (autoRefreshInterval) {
    clearInterval(autoRefreshInterval);
  }

  if (isAutoRefreshEnabled) {
    autoRefreshInterval = setInterval(() => {
      // 페이지가 보이는 상태일 때만 갱신
      if (!document.hidden) {
        updateReportCount();
        updateContactCount();
        refreshQuizListSilently();
      }
    }, 15000); // 15초마다
  }
}

// 퀴즈 목록 조용히 갱신 (스크롤 위치 유지)
async function refreshQuizListSilently() {
  try {
    const url = currentSearchTerm
      ? `/admin/quizzes/search?q=${encodeURIComponent(currentSearchTerm)}&page=1&limit=${allQuizzes.length || 10}&status=${currentFilterStatus}`
      : `/admin/quizzes?page=1&limit=${allQuizzes.length || 10}&status=${currentFilterStatus}`;

    const response = await fetchWithAuth(url);
    if (!response.ok) return;

    const data = await response.json();

    // 기존 퀴즈 개수와 비교
    if (data.quizzes.length !== allQuizzes.length) {
      showNotification(`퀴즈 목록이 변경되었습니다. (${data.quizzes.length}개)`);
    }

    // 목록 업데이트 (스크롤 위치는 유지)
    allQuizzes = data.quizzes;
    renderQuizTable(allQuizzes);

  } catch (error) {
    console.error('Silent refresh error:', error);
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
    updateReportCount();
    updateContactCount();
    refreshQuizListSilently();
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

// 사용자 정지 (대시보드에서)
async function suspendUserFromDashboard(userId, nickname) {
  const daysInput = prompt(`"${nickname}" 사용자를 정지하시겠습니까?\n\n정지 기간을 일수로 입력하세요.\n(빈 칸 또는 0 입력 시 영구 정지)`);

  if (daysInput === null) {
    return;
  }

  const days = daysInput.trim() === '' || daysInput.trim() === '0' ? null : parseInt(daysInput);

  if (days !== null && (isNaN(days) || days < 1)) {
    alert('유효한 일수를 입력해주세요. (1 이상의 숫자 또는 빈 칸)');
    return;
  }

  const reason = prompt('정지 사유를 입력하세요 (선택사항):');

  if (reason === null) {
    return;
  }

  const confirmMessage = days
    ? `"${nickname}" 사용자를 ${days}일간 정지하시겠습니까?`
    : `"${nickname}" 사용자를 영구 정지하시겠습니까?`;

  if (!confirm(confirmMessage)) {
    return;
  }

  try {
    const response = await fetchWithAuth(`/admin/users/${userId}/suspend`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        days,
        reason: reason || '관리자 조치'
      })
    });

    const data = await response.json();

    if (response.ok) {
      alert(data.message);
      await loadQuizzes(true); // 목록 새로고침
    } else {
      alert(data.message || '사용자 정지 처리 중 오류가 발생했습니다.');
    }
  } catch (err) {
    console.error('User suspend error:', err);
    alert('사용자 정지 처리 중 오류가 발생했습니다.');
  }
}

// 사용자 닉네임 변경 (관리자 전용)
async function changeUserNickname(userId, currentNickname) {
  const newNickname = prompt(`"${currentNickname}" 사용자의 닉네임을 변경하시겠습니까?\n\n새 닉네임을 입력하세요 (2-20자):`, currentNickname);

  if (newNickname === null) {
    return;
  }

  const trimmedNickname = newNickname.trim();

  if (trimmedNickname.length < 2 || trimmedNickname.length > 20) {
    alert('닉네임은 2자 이상 20자 이하로 입력해주세요.');
    return;
  }

  if (trimmedNickname === currentNickname) {
    alert('기존 닉네임과 동일합니다.');
    return;
  }

  if (!confirm(`닉네임을 "${currentNickname}"에서 "${trimmedNickname}"으로 변경하시겠습니까?`)) {
    return;
  }

  try {
    const response = await fetchWithAuth(`/admin/users/${userId}/nickname`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nickname: trimmedNickname })
    });

    const data = await response.json();

    if (response.ok) {
      alert(data.message);
      await loadQuizzes(true); // 목록 새로고침
    } else {
      alert(data.message || '닉네임 변경 중 오류가 발생했습니다.');
    }
  } catch (err) {
    console.error('User nickname change error:', err);
    alert('닉네임 변경 중 오류가 발생했습니다.');
  }
}

// 썸네일 변경 핸들러
async function handleEditThumbnailChange(event) {
  const file = event.target.files[0];
  if (!file) return;

  try {
    // 파일 타입 검증
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];
    if (!allowedTypes.includes(file.type)) {
      alert('지원하지 않는 파일 형식입니다.\n\n지원 형식: JPEG, PNG, WebP, GIF');
      event.target.value = '';
      return;
    }

    // 파일 크기 검증 (10MB)
    const sizeMB = file.size / (1024 * 1024);
    if (sizeMB > 10) {
      alert(`파일 크기가 너무 큽니다.\n\n최대: 10MB\n현재: ${sizeMB.toFixed(2)}MB`);
      event.target.value = '';
      return;
    }

    // File 객체 저장
    editThumbnailFile = file;

    // ObjectURL로 미리보기 (Base64 대신)
    const preview = document.getElementById('editThumbnailImage');
    if (preview.src && preview.src.startsWith('blob:')) {
      URL.revokeObjectURL(preview.src);
    }
    preview.src = URL.createObjectURL(file);

  } catch (error) {
    console.error('이미지 처리 실패:', error);
    alert('이미지 처리 실패: ' + error.message);
    event.target.value = '';
    editThumbnailFile = null;
  }
}

// 수정 모달 열기 (썸네일 포함)
async function openEditModal(quizId) {
  try {
    currentEditQuizId = quizId;

    // 퀴즈 정보 가져오기
    const response = await fetchWithAuth(`/api/quiz/${quizId}`);
    if (!response.ok) {
      throw new Error('퀴즈 정보를 불러오는데 실패했습니다.');
    }

    const quiz = await response.json();

    // 폼에 데이터 설정
    document.getElementById('editTitle').value = quiz.title || '';
    document.getElementById('editDescription').value = quiz.description || '';

    // 썸네일 이미지 설정
    editThumbnailFile = null; // 새 파일 없음
    editThumbnailUrl = quiz.titleImageBase64 || null; // 기존 URL 저장
    const thumbnailImage = document.getElementById('editThumbnailImage');

    if (editThumbnailUrl) {
      thumbnailImage.src = editThumbnailUrl;
    } else {
      // 기본 이미지 설정
      thumbnailImage.src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="400" height="300"%3E%3Crect width="400" height="300" fill="%234F46E5"/%3E%3Ctext x="50%25" y="50%25" dominant-baseline="middle" text-anchor="middle" font-family="sans-serif" font-size="24" fill="white"%3E썸네일 없음%3C/text%3E%3C/svg%3E';
    }

    // 모달 열기
    document.getElementById('editModal').classList.remove('hidden');
    document.getElementById('editModal').classList.add('flex');

  } catch (error) {
    console.error('모달 열기 실패:', error);
    alert('퀴즈 정보를 불러오는데 실패했습니다.');
  }
}

// 수정 모달 닫기
function closeEditModal() {
  currentEditQuizId = null;
  editThumbnailFile = null;
  editThumbnailUrl = null;

  // ObjectURL 메모리 해제
  const preview = document.getElementById('editThumbnailImage');
  if (preview && preview.src && preview.src.startsWith('blob:')) {
    URL.revokeObjectURL(preview.src);
  }

  document.getElementById('editModal').classList.add('hidden');
  document.getElementById('editModal').classList.remove('flex');
  document.getElementById('editThumbnailInput').value = '';
}

// 수정 저장
async function saveEdit() {
  const title = document.getElementById('editTitle').value.trim();
  const description = document.getElementById('editDescription').value.trim();

  if (!title) {
    alert('제목은 필수입니다.');
    return;
  }

  if (!editThumbnailFile && !editThumbnailUrl) {
    alert('썸네일 이미지는 필수입니다.');
    return;
  }

  try {
    let finalThumbnailUrl = editThumbnailUrl;

    // 새 이미지를 선택한 경우 S3에 업로드
    if (editThumbnailFile) {
      try {
        finalThumbnailUrl = await uploadToS3WithPresignedUrl(
          editThumbnailFile,
          'thumbnails',
          currentEditQuizId
        );
      } catch (uploadError) {
        alert('이미지 업로드 실패: ' + uploadError.message);
        return;
      }
    }

    const response = await fetchWithAuth(`/api/quiz/${currentEditQuizId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title,
        description,
        titleImageBase64: finalThumbnailUrl
      })
    });

    const result = await response.json();

    if (response.ok) {
      alert('수정되었습니다.');
      closeEditModal();
      await loadQuizzes(true); // 목록 새로고침
    } else {
      alert(result.message || '수정에 실패했습니다.');
    }
  } catch (error) {
    console.error('수정 실패:', error);
    alert('수정 중 오류가 발생했습니다.');
  }
}

// 전역 함수로 등록
window.toggleVisibility = toggleVisibility;
window.seizeQuiz = seizeQuiz;
window.restoreQuiz = restoreQuiz;
window.deleteQuiz = deleteQuiz;
window.toggleAutoRefresh = toggleAutoRefresh;
window.suspendUserFromDashboard = suspendUserFromDashboard;
window.changeUserNickname = changeUserNickname;
window.openEditModal = openEditModal;
window.closeEditModal = closeEditModal;
window.saveEdit = saveEdit;
window.handleEditThumbnailChange = handleEditThumbnailChange;

// 페이지 로드 시 초기화
document.addEventListener('DOMContentLoaded', initializePage);
