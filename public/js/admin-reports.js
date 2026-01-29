// admin-reports.js
import { renderNavbar, highlightCurrentPage } from './navbar.js';
import { renderFooter } from './footer.js';

let allReportedQuizzes = [];
let currentPage = 1;
let isLoading = false;
let hasMore = true;
let currentUser = null;
let tooltipHideTimer = null;

// 댓글 신고 관련 변수
let allReportedComments = [];
let commentCurrentPage = 1;
let isCommentLoading = false;
let commentHasMore = true;
let currentTab = 'quiz'; // 'quiz' or 'comment'

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

    // 관리자 권한 체크
    if (user.role !== 'admin' && user.role !== 'superadmin') {
      alert('관리자 권한이 필요합니다.');
      window.location.href = '/';
      return;
    }

    currentUser = user;

    // 탭 이벤트 리스너 설정
    setupTabListeners();

    // 신고된 퀴즈 목록 로드 (기본 탭)
    await loadReportedQuizzes();

    // 무한 스크롤 이벤트 리스너
    window.addEventListener('scroll', handleScroll);
  } catch (error) {
    console.error('페이지 초기화 실패:', error);
    alert('페이지 초기화 중 오류가 발생했습니다.');
  }
}

// 탭 이벤트 리스너 설정
function setupTabListeners() {
  const quizTab = document.getElementById('quizTab');
  const commentTab = document.getElementById('commentTab');

  quizTab.addEventListener('click', () => {
    if (currentTab === 'quiz') return;

    currentTab = 'quiz';

    // 탭 스타일 변경
    quizTab.classList.add('border-red-500', 'text-red-500');
    quizTab.classList.remove('border-transparent', 'text-gray-400');
    commentTab.classList.remove('border-red-500', 'text-red-500');
    commentTab.classList.add('border-transparent', 'text-gray-400');

    // 섹션 표시/숨김
    document.getElementById('quizReportsSection').classList.remove('hidden');
    document.getElementById('commentReportsSection').classList.add('hidden');
  });

  commentTab.addEventListener('click', async () => {
    if (currentTab === 'comment') return;

    currentTab = 'comment';

    // 탭 스타일 변경
    commentTab.classList.add('border-red-500', 'text-red-500');
    commentTab.classList.remove('border-transparent', 'text-gray-400');
    quizTab.classList.remove('border-red-500', 'text-red-500');
    quizTab.classList.add('border-transparent', 'text-gray-400');

    // 섹션 표시/숨김
    document.getElementById('commentReportsSection').classList.remove('hidden');
    document.getElementById('quizReportsSection').classList.add('hidden');

    // 댓글 신고 목록이 비어있으면 로드
    if (allReportedComments.length === 0) {
      await loadReportedComments();
    }
  });
}

// 신고된 퀴즈 목록 로드
async function loadReportedQuizzes(reset = false) {
  if (isLoading || (!hasMore && !reset)) return;

  try {
    isLoading = true;

    if (reset) {
      currentPage = 1;
      allReportedQuizzes = [];
      hasMore = true;
    }

    // 로딩 상태 표시
    if (currentPage === 1) {
      document.getElementById('quizLoadingState').classList.remove('hidden');
      document.getElementById('quizReportsContainer').classList.add('hidden');
      document.getElementById('quizEmptyState').classList.add('hidden');
    } else {
      showLoadMoreIndicator('quiz');
    }

    const response = await fetchWithAuth(`/admin/reported-quizzes?page=${currentPage}&limit=40`);

    if (!response.ok) {
      if (response.status === 403) {
        alert('관리자 권한이 필요합니다.');
        window.location.href = '/';
        return;
      }
      throw new Error('신고된 퀴즈 목록 로드 실패');
    }

    const data = await response.json();

    // 새로운 퀴즈 추가
    allReportedQuizzes = [...allReportedQuizzes, ...data.quizzes];
    hasMore = data.pagination.hasMore;

    // 렌더링
    renderReportedQuizzes();

    // 로딩 상태 업데이트
    document.getElementById('quizLoadingState').classList.add('hidden');
    hideLoadMoreIndicator('quiz');

    if (allReportedQuizzes.length === 0) {
      document.getElementById('quizEmptyState').classList.remove('hidden');
    } else {
      document.getElementById('quizReportsContainer').classList.remove('hidden');
    }

    // 다음 페이지 준비
    currentPage++;
  } catch (err) {
    console.error('신고된 퀴즈 로드 에러:', err);
    if (currentPage === 1) {
      document.getElementById('quizLoadingState').innerHTML = `
        <p class="text-red-400">신고된 퀴즈 목록을 불러오는데 실패했습니다.</p>
        <button onclick="location.reload()" class="mt-4 bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded-lg">
          다시 시도
        </button>
      `;
    }
    hideLoadMoreIndicator('quiz');
  } finally {
    isLoading = false;
  }
}

// 문제 이미지 미리보기 툴팁 생성
function createImagePreviewTooltip(questions) {
  if (!questions || questions.length === 0) {
    return '';
  }

  // 이미지가 있는 문제만 필터링
  const questionsWithImages = questions.filter(q => q.imageBase64 || q.answerImageBase64);

  if (questionsWithImages.length === 0) {
    return '<div class="image-preview-tooltip absolute left-full ml-2 top-0 hidden bg-gray-800 text-white text-xs rounded px-2 py-1 whitespace-nowrap z-50">이미지 없음</div>';
  }

  const imageItems = questionsWithImages.map((q, idx) => {
    let html = '';
    if (q.imageBase64) {
      html += `<div class="mb-2"><div class="text-xs text-gray-400 mb-1">문제 ${q.order || idx + 1}</div><img src="${q.imageBase64}" class="w-32 h-24 object-cover rounded"></div>`;
    }
    if (q.answerImageBase64) {
      html += `<div class="mb-2"><div class="text-xs text-gray-400 mb-1">정답 ${q.order || idx + 1}</div><img src="${q.answerImageBase64}" class="w-32 h-24 object-cover rounded"></div>`;
    }
    return html;
  }).join('');

  return `
    <div class="image-preview-tooltip absolute left-full ml-2 top-0 hidden bg-gray-900 border border-gray-700 rounded-lg p-3 shadow-xl z-50 max-h-96 overflow-y-auto" style="min-width: 150px;">
      <div class="text-xs font-semibold text-gray-300 mb-2">문제 이미지 (${questionsWithImages.length})</div>
      ${imageItems}
    </div>
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
function setupTooltipEvents(thumbnailElement, tooltip) {
  // 썸네일에 마우스 올리면 표시
  thumbnailElement.addEventListener('mouseenter', () => {
    showTooltip(tooltip);
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

// 신고된 퀴즈 렌더링
function renderReportedQuizzes() {
  const container = document.getElementById('quizReportsContainer');
  container.innerHTML = '';

  allReportedQuizzes.forEach(quiz => {
    const card = createQuizCard(quiz);
    container.appendChild(card);
  });
}

// 신고된 댓글 목록 로드
async function loadReportedComments(reset = false) {
  if (isCommentLoading || (!commentHasMore && !reset)) return;

  try {
    isCommentLoading = true;

    if (reset) {
      commentCurrentPage = 1;
      allReportedComments = [];
      commentHasMore = true;
    }

    // 로딩 상태 표시
    if (commentCurrentPage === 1) {
      document.getElementById('commentLoadingState').classList.remove('hidden');
      document.getElementById('commentReportsContainer').classList.add('hidden');
      document.getElementById('commentEmptyState').classList.add('hidden');
    } else {
      showLoadMoreIndicator('comment');
    }

    const response = await fetchWithAuth(`/admin/reported-comments?page=${commentCurrentPage}&limit=40`);

    if (!response.ok) {
      if (response.status === 403) {
        alert('관리자 권한이 필요합니다.');
        window.location.href = '/';
        return;
      }
      throw new Error('신고된 댓글 목록 로드 실패');
    }

    const data = await response.json();

    // 새로운 댓글 추가
    allReportedComments = [...allReportedComments, ...data.comments];
    commentHasMore = data.pagination.hasMore;

    // 렌더링
    renderReportedComments();

    // 로딩 상태 업데이트
    document.getElementById('commentLoadingState').classList.add('hidden');
    hideLoadMoreIndicator('comment');

    if (allReportedComments.length === 0) {
      document.getElementById('commentEmptyState').classList.remove('hidden');
    } else {
      document.getElementById('commentReportsContainer').classList.remove('hidden');
    }

    // 다음 페이지 준비
    commentCurrentPage++;
  } catch (err) {
    console.error('신고된 댓글 로드 에러:', err);
    if (commentCurrentPage === 1) {
      document.getElementById('commentLoadingState').innerHTML = `
        <p class="text-red-400">신고된 댓글 목록을 불러오는데 실패했습니다.</p>
        <button onclick="location.reload()" class="mt-4 bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded-lg">
          다시 시도
        </button>
      `;
    }
    hideLoadMoreIndicator('comment');
  } finally {
    isCommentLoading = false;
  }
}

// 신고된 댓글 렌더링
function renderReportedComments() {
  const container = document.getElementById('commentReportsContainer');
  container.innerHTML = '';

  allReportedComments.forEach(comment => {
    const card = createCommentCard(comment);
    container.appendChild(card);
  });
}

// 퀴즈 카드 생성
function createQuizCard(quiz) {
  const card = document.createElement('div');
  card.className = 'bg-black/30 rounded-2xl p-6 shadow-xl border border-gray-600 cursor-pointer hover:bg-black/40 transition-colors';

  const isSeized = quiz.creatorId === 'seized';
  const createdDate = new Date(quiz.createdAt).toLocaleDateString('ko-KR');

  card.innerHTML = `
    <!-- 퀴즈 정보 -->
    <div class="flex items-start gap-4 mb-4">
      <div class="relative flex-shrink-0">
        ${quiz.titleImageBase64 ? `
          <img src="${quiz.titleImageBase64}" alt="썸네일" class="w-24 h-24 rounded-lg object-cover cursor-pointer">
        ` : `
          <div class="w-24 h-24 rounded-lg bg-gradient-to-br from-red-500 to-orange-600 flex items-center justify-center text-white font-bold text-2xl cursor-pointer">
            Q
          </div>
        `}
        ${createImagePreviewTooltip(quiz.questions)}
      </div>
      <div class="flex-1 min-w-0">
        <h3 class="text-xl font-bold text-white mb-2">${quiz.title}</h3>
        <p class="text-gray-400 text-sm mb-3">${quiz.description || '설명 없음'}</p>
        <div class="flex flex-wrap gap-3 text-sm">
          <div class="flex items-center gap-2">
            <span class="text-gray-500">작성자:</span>
            <span class="text-white">${quiz.creator.nickname}</span>
            <span class="text-gray-500">(${quiz.creator.email})</span>
            ${!isSeized && quiz.creatorId ? `
              <button
                onclick="event.stopPropagation(); suspendUserFromQuizReport('${quiz.creatorId}', '${quiz.creator.nickname.replace(/'/g, "\\'")}')"
                class="ml-2 px-2 py-1 text-xs bg-yellow-600 hover:bg-yellow-500 text-white rounded transition-colors"
              >
                사용자 정지
              </button>
            ` : ''}
          </div>
          <div class="flex items-center gap-2">
            <span class="text-gray-500">문제 수:</span>
            <span class="text-white">${quiz.questions?.length || 0}개</span>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-gray-500">생성일:</span>
            <span class="text-white">${createdDate}</span>
          </div>
          <div class="flex items-center gap-2">
            ${isSeized ? `
              <span class="px-2 py-1 rounded text-xs font-semibold bg-orange-500/20 text-orange-400 border border-orange-500">
                압수됨
              </span>
            ` : `
              <span class="px-2 py-1 rounded text-xs font-semibold ${
                quiz.isComplete
                  ? 'bg-green-500/20 text-green-400 border border-green-500'
                  : 'bg-red-500/20 text-red-400 border border-red-500'
              }">
                ${quiz.isComplete ? '공개' : '비공개'}
              </span>
            `}
          </div>
        </div>
      </div>
    </div>

    <!-- 신고 내역 -->
    <div class="border-t border-gray-700 pt-4">
      <div class="flex items-center justify-between mb-3">
        <h4 class="text-lg font-semibold text-red-400">신고 내역 (${quiz.reports.length}건)</h4>
        <div class="flex gap-2">
          ${!isSeized ? `
            <button
              onclick="seizeQuizFromReport('${quiz._id}', '${quiz.title.replace(/'/g, "\\'")}')"
              class="bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            >
              압수하기
            </button>
          ` : `
            <button
              onclick="restoreQuizFromReport('${quiz._id}', '${quiz.title.replace(/'/g, "\\'")}')"
              class="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            >
              복구하기
            </button>
          `}
          ${currentUser && currentUser.role === 'superadmin' ? `
            <button
              onclick="deleteQuizFromReport('${quiz._id}', '${quiz.title.replace(/'/g, "\\'")}')"
              class="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            >
              영구삭제
            </button>
          ` : ''}
          <button
            onclick="dismissReports('${quiz._id}', '${quiz.title.replace(/'/g, "\\'")}')"
            class="bg-gray-600 hover:bg-gray-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            신고 삭제
          </button>
        </div>
      </div>

      <!-- 신고 목록 -->
      <div class="space-y-2">
        ${quiz.reports.map((report, index) => `
          <div class="bg-gray-800/50 rounded-lg p-3">
            <div class="flex items-start justify-between">
              <div class="flex-1">
                <div class="flex items-center gap-2 mb-1">
                  <span class="text-white font-medium">${report.reporter.nickname}</span>
                  <span class="text-gray-500 text-xs">(${report.reporter.email})</span>
                  <span class="text-gray-500 text-xs">
                    ${new Date(report.reportedAt).toLocaleString('ko-KR')}
                  </span>
                </div>
                <p class="text-gray-300 text-sm">${report.reason}</p>
              </div>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;

  // 카드 클릭 이벤트 - 퀴즈 편집 페이지로 이동
  card.onclick = (e) => {
    // 버튼 클릭은 무시
    if (e.target.tagName === 'BUTTON' || e.target.closest('button')) {
      return;
    }
    window.location.href = `/quiz/edit?quizId=${quiz._id}`;
  };

  // 썸네일 이미지 미리보기 툴팁 이벤트 설정
  // DOM에 삽입된 후 이벤트를 연결하기 위해 다음 틱에 실행
  setTimeout(() => {
    const thumbnailContainer = card.querySelector('.relative.flex-shrink-0');
    const tooltip = card.querySelector('.image-preview-tooltip');
    if (thumbnailContainer && tooltip) {
      const thumbnailElement = thumbnailContainer.querySelector('img, div.w-24');
      if (thumbnailElement) {
        setupTooltipEvents(thumbnailElement, tooltip);
      }
    }
  }, 0);

  return card;
}

// 댓글 카드 생성
function createCommentCard(comment) {
  const card = document.createElement('div');
  card.className = 'bg-black/30 rounded-2xl p-6 shadow-xl border border-gray-600';

  const createdDate = new Date(comment.createdAt).toLocaleDateString('ko-KR');
  const isHidden = comment.isCommentHidden;

  // 신고 사유를 한글로 변환
  const reasonMap = {
    'spam': '스팸',
    'abuse': '욕설/비방',
    'inappropriate': '부적절한 내용',
    'other': '기타'
  };

  card.innerHTML = `
    <!-- 댓글 정보 -->
    <div class="mb-4">
      <div class="flex items-start gap-4">
        <div class="flex-shrink-0">
          ${comment.profileImage ? `
            <img src="${comment.profileImage}" alt="프로필" class="w-12 h-12 rounded-full object-cover">
          ` : `
            <div class="w-12 h-12 rounded-full bg-gradient-to-br from-purple-500 to-blue-600 flex items-center justify-center text-white font-bold text-lg">
              ${comment.nickname.charAt(0)}
            </div>
          `}
        </div>
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 mb-2">
            <span class="text-white font-semibold">${comment.nickname}</span>
            ${comment.author ? `<span class="text-gray-500 text-xs">(${comment.author.email})</span>` : ''}
            <span class="text-gray-500 text-xs">${createdDate}</span>
            ${isHidden ? `
              <span class="px-2 py-1 rounded text-xs font-semibold bg-orange-500/20 text-orange-400 border border-orange-500">
                숨김
              </span>
            ` : ''}
            ${comment.userId ? `
              <button
                onclick="suspendUserFromComment('${comment.userId}', '${comment.nickname.replace(/'/g, "\\'")}')"
                class="ml-2 px-2 py-1 text-xs bg-yellow-600 hover:bg-yellow-500 text-white rounded transition-colors"
              >
                사용자 정지
              </button>
            ` : ''}
          </div>
          <p class="text-gray-300 text-sm mb-2">${comment.content}</p>
          ${comment.quizId ? `
            <div class="text-gray-500 text-xs">
              퀴즈 ID: <a href="/quiz/session?quizId=${comment.quizId}" class="text-blue-400 hover:underline" target="_blank">${comment.quizId}</a>
            </div>
          ` : ''}
        </div>
      </div>
    </div>

    <!-- 신고 내역 -->
    <div class="border-t border-gray-700 pt-4">
      <div class="flex items-center justify-between mb-3">
        <h4 class="text-lg font-semibold text-red-400">신고 내역 (${comment.commentReports?.length || 0}건)</h4>
        <div class="flex gap-2">
          ${!isHidden ? `
            <button
              onclick="hideCommentFromReport('${comment._id}', '${comment.content.replace(/'/g, "\\'").substring(0, 30)}...')"
              class="bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            >
              숨기기
            </button>
          ` : ''}
          ${currentUser && currentUser.role === 'superadmin' ? `
            <button
              onclick="deleteCommentFromReport('${comment._id}', '${comment.content.replace(/'/g, "\\'").substring(0, 30)}...')"
              class="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            >
              영구삭제
            </button>
          ` : ''}
          <button
            onclick="dismissCommentReports('${comment._id}', '${comment.content.replace(/'/g, "\\'").substring(0, 30)}...')"
            class="bg-gray-600 hover:bg-gray-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            신고 삭제
          </button>
        </div>
      </div>

      <!-- 신고 목록 -->
      <div class="space-y-2">
        ${comment.commentReports?.map((report, index) => `
          <div class="bg-gray-800/50 rounded-lg p-3">
            <div class="flex items-start justify-between">
              <div class="flex-1">
                <div class="flex items-center gap-2 mb-1">
                  <span class="text-white font-medium">${report.reporterNickname}</span>
                  ${report.reporter ? `<span class="text-gray-500 text-xs">(${report.reporter.email})</span>` : ''}
                  <span class="text-gray-500 text-xs">
                    ${new Date(report.reportedAt).toLocaleString('ko-KR')}
                  </span>
                </div>
                <div class="text-gray-300 text-sm mb-1">
                  <span class="font-semibold text-red-400">${reasonMap[report.reason] || report.reason}</span>
                </div>
                ${report.description ? `
                  <p class="text-gray-400 text-xs">${report.description}</p>
                ` : ''}
              </div>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;

  return card;
}

// 퀴즈 압수
async function seizeQuizFromReport(quizId, title) {
  const reason = prompt(`"${title}" 퀴즈를 압수하시겠습니까?\n\n압수 사유를 입력하세요 (선택사항):`);

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
      await loadReportedQuizzes(true); // 목록 새로고침
    } else {
      alert(data.message || '압수 처리 중 오류가 발생했습니다.');
    }
  } catch (err) {
    console.error('Quiz seize error:', err);
    alert('압수 처리 중 오류가 발생했습니다.');
  }
}

// 퀴즈 복구
async function restoreQuizFromReport(quizId, title) {
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
      await loadReportedQuizzes(true); // 목록 새로고침
    } else {
      alert(data.message || '복구 처리 중 오류가 발생했습니다.');
    }
  } catch (err) {
    console.error('Quiz restore error:', err);
    alert('복구 처리 중 오류가 발생했습니다.');
  }
}

// 퀴즈 영구 삭제
async function deleteQuizFromReport(quizId, title) {
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
      await loadReportedQuizzes(true); // 목록 새로고침
    } else {
      alert(data.message || '삭제 중 오류가 발생했습니다.');
    }
  } catch (err) {
    console.error('Quiz delete error:', err);
    alert('삭제 중 오류가 발생했습니다.');
  }
}

// 신고 삭제 (조치 없이 신고만 삭제)
async function dismissReports(quizId, title) {
  if (!confirm(`"${title}" 퀴즈의 모든 신고를 삭제하시겠습니까?\n\n퀴즈는 그대로 유지됩니다.`)) {
    return;
  }

  try {
    const response = await fetchWithAuth(`/admin/quizzes/${quizId}/reports`, {
      method: 'DELETE'
    });

    const data = await response.json();

    if (response.ok) {
      alert(data.message);
      await loadReportedQuizzes(true); // 목록 새로고침
    } else {
      alert(data.message || '신고 삭제 중 오류가 발생했습니다.');
    }
  } catch (err) {
    console.error('Report dismiss error:', err);
    alert('신고 삭제 중 오류가 발생했습니다.');
  }
}

// 댓글 숨기기
async function hideCommentFromReport(commentId, preview) {
  const reason = prompt(`"${preview}" 댓글을 숨기시겠습니까?\n\n숨김 사유를 입력하세요 (선택사항):`);

  if (reason === null) {
    return;
  }

  try {
    const response = await fetchWithAuth(`/admin/comments/${commentId}/hide`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: reason || '관리자 조치' })
    });

    const data = await response.json();

    if (response.ok) {
      alert(data.message);
      await loadReportedComments(true); // 목록 새로고침
    } else {
      alert(data.message || '숨김 처리 중 오류가 발생했습니다.');
    }
  } catch (err) {
    console.error('Comment hide error:', err);
    alert('숨김 처리 중 오류가 발생했습니다.');
  }
}

// 댓글 영구 삭제
async function deleteCommentFromReport(commentId, preview) {
  if (!confirm(`"${preview}" 댓글을 영구 삭제하시겠습니까?\n\n⚠️ 이 작업은 되돌릴 수 없습니다.`)) {
    return;
  }

  try {
    const response = await fetchWithAuth(`/admin/comments/${commentId}`, {
      method: 'DELETE'
    });

    const data = await response.json();

    if (response.ok) {
      alert(data.message);
      await loadReportedComments(true); // 목록 새로고침
    } else {
      alert(data.message || '삭제 중 오류가 발생했습니다.');
    }
  } catch (err) {
    console.error('Comment delete error:', err);
    alert('삭제 중 오류가 발생했습니다.');
  }
}

// 댓글 신고 삭제 (조치 없이 신고만 삭제)
async function dismissCommentReports(commentId, preview) {
  if (!confirm(`"${preview}" 댓글의 모든 신고를 삭제하시겠습니까?\n\n댓글은 그대로 유지됩니다.`)) {
    return;
  }

  try {
    const response = await fetchWithAuth(`/admin/comments/${commentId}/reports`, {
      method: 'DELETE'
    });

    const data = await response.json();

    if (response.ok) {
      alert(data.message);
      await loadReportedComments(true); // 목록 새로고침
    } else {
      alert(data.message || '신고 삭제 중 오류가 발생했습니다.');
    }
  } catch (err) {
    console.error('Comment report dismiss error:', err);
    alert('신고 삭제 중 오류가 발생했습니다.');
  }
}

// 무한 스크롤 핸들러
function handleScroll() {
  const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
  const scrollHeight = document.documentElement.scrollHeight;
  const clientHeight = document.documentElement.clientHeight;

  // 하단에서 200px 정도 남았을 때 로드
  if (scrollTop + clientHeight >= scrollHeight - 200) {
    if (currentTab === 'quiz') {
      loadReportedQuizzes();
    } else {
      loadReportedComments();
    }
  }
}

// 로딩 인디케이터 표시
function showLoadMoreIndicator(tab = 'quiz') {
  const indicatorId = tab === 'quiz' ? 'loadMoreIndicatorQuiz' : 'loadMoreIndicatorComment';
  const containerId = tab === 'quiz' ? 'quizReportsContainer' : 'commentReportsContainer';
  const loadingText = tab === 'quiz' ? '추가 퀴즈를 불러오는 중...' : '추가 댓글을 불러오는 중...';

  let indicator = document.getElementById(indicatorId);
  if (!indicator) {
    indicator = document.createElement('div');
    indicator.id = indicatorId;
    indicator.className = 'text-center py-8';
    indicator.innerHTML = `
      <div class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-red-500"></div>
      <p class="text-gray-400 mt-2">${loadingText}</p>
    `;
    document.getElementById(containerId).appendChild(indicator);
  }
  indicator.classList.remove('hidden');
}

// 로딩 인디케이터 숨기기
function hideLoadMoreIndicator(tab = 'quiz') {
  const indicatorId = tab === 'quiz' ? 'loadMoreIndicatorQuiz' : 'loadMoreIndicatorComment';
  const indicator = document.getElementById(indicatorId);
  if (indicator) {
    indicator.classList.add('hidden');
  }
}

// 사용자 정지
async function suspendUserFromComment(userId, nickname) {
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
      await loadReportedComments(true); // 목록 새로고침
    } else {
      alert(data.message || '사용자 정지 처리 중 오류가 발생했습니다.');
    }
  } catch (err) {
    console.error('User suspend error:', err);
    alert('사용자 정지 처리 중 오류가 발생했습니다.');
  }
}

// 사용자 정지 (퀴즈 신고에서)
async function suspendUserFromQuizReport(userId, nickname) {
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
      await loadReportedQuizzes(true); // 목록 새로고침
    } else {
      alert(data.message || '사용자 정지 처리 중 오류가 발생했습니다.');
    }
  } catch (err) {
    console.error('User suspend error:', err);
    alert('사용자 정지 처리 중 오류가 발생했습니다.');
  }
}

// 전역 함수로 등록
window.seizeQuizFromReport = seizeQuizFromReport;
window.restoreQuizFromReport = restoreQuizFromReport;
window.deleteQuizFromReport = deleteQuizFromReport;
window.dismissReports = dismissReports;
window.hideCommentFromReport = hideCommentFromReport;
window.deleteCommentFromReport = deleteCommentFromReport;
window.dismissCommentReports = dismissCommentReports;
window.suspendUserFromComment = suspendUserFromComment;
window.suspendUserFromQuizReport = suspendUserFromQuizReport;

// 페이지 로드 시 초기화
document.addEventListener('DOMContentLoaded', initializePage);
