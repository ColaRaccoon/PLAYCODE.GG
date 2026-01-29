// quiz-comments.js - 퀴즈 댓글 관리 모듈

let currentQuizId = null;
let currentUser = null;
let currentPage = 1;
let totalPages = 1;
let isLoading = false;
let isInitialized = false; // 초기화 여부 플래그

/**
 * 댓글 모듈 초기화
 * @param {string} quizId - 퀴즈 ID
 * @param {object} user - 현재 로그인한 사용자 정보
 */
export function initializeComments(quizId, user) {
  // 이미 초기화되었으면 quizId와 user만 업데이트하고 리턴
  if (isInitialized) {
    currentQuizId = quizId;
    currentUser = user;
    return;
  }

  currentQuizId = quizId;
  currentUser = user;
  isInitialized = true;

  // DOM이 준비될 때까지 대기 후 초기화
  const initializeDOM = () => {
    // 댓글 입력 이벤트 리스너 등록
    const commentForm = document.getElementById('commentForm');
    const commentInput = document.getElementById('commentInput');
    const submitCommentBtn = document.getElementById('submitCommentBtn');

    // DOM이 아직 준비되지 않았으면 100ms 후 재시도
    if (!commentForm || !commentInput || !submitCommentBtn) {
      setTimeout(initializeDOM, 100);
      return;
    }

    // 비로그인 사용자는 댓글 입력란 비활성화
    if (!currentUser) {
      commentInput.disabled = true;
      commentInput.placeholder = '댓글을 작성하려면 로그인이 필요합니다';
      submitCommentBtn.disabled = true;
    } else {
      // 폼 제출 이벤트
      commentForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        await submitComment();
      });

      // 입력 필드 변경 이벤트 (버튼 활성화/비활성화)
      commentInput.addEventListener('input', () => {
        const content = commentInput.value.trim();
        submitCommentBtn.disabled = content.length === 0;
      });
    }

    // 페이지네이션 버튼 이벤트 리스너
    const prevBtn = document.getElementById('prevCommentsBtn');
    const nextBtn = document.getElementById('nextCommentsBtn');

    if (prevBtn) {
      prevBtn.addEventListener('click', () => {
        if (currentPage > 1) {
          currentPage--;
          loadComments();
        }
      });
    }

    if (nextBtn) {
      nextBtn.addEventListener('click', () => {
        if (currentPage < totalPages) {
          currentPage++;
          loadComments();
        }
      });
    }

    // 댓글 수정/삭제/신고 버튼 이벤트 위임
    const commentsContainer = document.getElementById('commentsContainer');
    if (commentsContainer) {
      commentsContainer.addEventListener('click', async (e) => {
        // 프로필 이미지 클릭 → 신고 버튼 토글
        if (e.target.classList.contains('comment-profile-image') || e.target.classList.contains('comment-profile-avatar')) {
          const commentItem = e.target.closest('.comment-item');
          const reportBtn = commentItem.querySelector('.report-comment-btn');
          if (reportBtn) {
            reportBtn.classList.toggle('hidden');
          }
        }

        // 신고 버튼 클릭
        if (e.target.classList.contains('report-comment-btn')) {
          const commentId = e.target.dataset.commentId;
          await reportComment(commentId);
        }

        // 수정 버튼 클릭
        if (e.target.classList.contains('edit-comment-btn')) {
          const commentId = e.target.dataset.commentId;
          showEditForm(commentId);
        }

        // 삭제 버튼 클릭
        if (e.target.classList.contains('delete-comment-btn')) {
          const commentId = e.target.dataset.commentId;
          await deleteComment(commentId);
        }

        // 수정 취소 버튼 클릭
        if (e.target.classList.contains('cancel-edit-btn')) {
          const commentItem = e.target.closest('.comment-item');
          hideEditForm(commentItem);
        }

        // 수정 저장 버튼 클릭
        if (e.target.classList.contains('save-edit-btn')) {
          const commentItem = e.target.closest('.comment-item');
          const commentId = commentItem.dataset.commentId;
          await saveEditComment(commentId, commentItem);
        }
      });
    }

    // 초기 댓글 로드 (한 번만)
    loadComments();
  };

  // 초기화 시작
  initializeDOM();
}

/**
 * 댓글 목록 로드
 */
export async function loadComments() {
  // currentQuizId가 없으면 세션에서 가져오기
  if (!currentQuizId) {
    const sessionId = window.location.pathname.split('/').pop();
    try {
      const response = await fetch(`/game/session/${sessionId}`, { credentials: 'include' });
      if (response.ok) {
        const sessionData = await response.json();
        currentQuizId = sessionData.quiz?._id;
        if (!currentQuizId) {
          return;
        }
      } else {
        return;
      }
    } catch (error) {
      return;
    }
  }

  if (isLoading) return;
  isLoading = true;

  const commentsContainer = document.getElementById('commentsContainer');
  const commentsLoading = document.getElementById('commentsLoading');
  const commentsError = document.getElementById('commentsError');

  if (!commentsContainer) {
    isLoading = false;
    return;
  }

  // 로딩 상태 표시
  if (commentsLoading) commentsLoading.classList.remove('hidden');
  if (commentsError) commentsError.classList.add('hidden');
  commentsContainer.innerHTML = '';

  try {
    const response = await fetch(`/api/quiz/${currentQuizId}/comments?page=${currentPage}&limit=20`, {
      credentials: 'include',
    });

    if (!response.ok) {
      throw new Error('댓글을 불러오는 데 실패했습니다.');
    }

    const data = await response.json();
    const comments = data.comments || [];
    const pagination = data.pagination || {};

    // 페이지 정보 업데이트
    totalPages = pagination.totalPages || 1;

    // 로딩 상태 숨김
    if (commentsLoading) commentsLoading.classList.add('hidden');

    // 댓글 렌더링
    if (comments.length === 0 && currentPage === 1) {
      commentsContainer.innerHTML = `
        <div class="text-center py-8 text-gray-400">
          <p>아직 댓글이 없습니다.</p>
          <p class="text-sm mt-2">첫 번째 댓글을 작성해보세요!</p>
        </div>
      `;
    } else {
      commentsContainer.innerHTML = comments.map(comment => createCommentHTML(comment)).join('');
    }

    // 페이지네이션 UI 업데이트
    updatePaginationUI();

  } catch (error) {
    console.error('댓글 로드 오류:', error);
    if (commentsLoading) commentsLoading.classList.add('hidden');
    if (commentsError) {
      commentsError.classList.remove('hidden');
      commentsError.textContent = error.message;
    }
  } finally {
    isLoading = false;
  }
}

/**
 * 페이지네이션 UI 업데이트
 */
function updatePaginationUI() {
  const prevBtn = document.getElementById('prevCommentsBtn');
  const nextBtn = document.getElementById('nextCommentsBtn');
  const pageInfo = document.getElementById('commentsPageInfo');

  if (pageInfo) {
    pageInfo.textContent = `${currentPage} / ${totalPages}`;
  }

  if (prevBtn) {
    prevBtn.disabled = currentPage <= 1;
  }

  if (nextBtn) {
    nextBtn.disabled = currentPage >= totalPages;
  }
}

/**
 * 댓글 HTML 생성
 * @param {object} comment - 댓글 객체
 * @returns {string} 댓글 HTML
 */
function createCommentHTML(comment) {
  const profileImage = comment.profileImage || null;
  const nickname = comment.nickname || 'Unknown';
  const content = escapeHtml(comment.content);
  const createdAt = formatDate(comment.createdAt);
  const commentId = comment._id;

  // 현재 사용자가 댓글 작성자인지 확인
  const isAuthor = currentUser && comment.userId && String(currentUser._id) === String(comment.userId);

  // 프로필 이미지 또는 기본 아바타 (클릭 가능하도록 cursor-pointer 추가)
  const avatarHTML = profileImage
    ? `<img src="${profileImage}" alt="${nickname}님의 프로필" class="comment-profile-image w-10 h-10 rounded-full object-cover cursor-pointer" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
       <div class="comment-profile-avatar w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-bold text-sm cursor-pointer" style="display: none;">
         ${nickname.charAt(0).toUpperCase()}
       </div>`
    : `<div class="comment-profile-avatar w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-bold text-sm cursor-pointer">
         ${nickname.charAt(0).toUpperCase()}
       </div>`;

  // 작성자에게만 수정/삭제 버튼 표시
  const actionButtons = isAuthor
    ? `<div class="flex items-center space-x-2 ml-2">
         <button class="edit-comment-btn text-xs text-blue-400 hover:text-blue-300 transition-colors" data-comment-id="${commentId}">수정</button>
         <span class="text-gray-500">|</span>
         <button class="delete-comment-btn text-xs text-red-400 hover:text-red-300 transition-colors" data-comment-id="${commentId}">삭제</button>
       </div>`
    : '';

  // 신고 버튼 (작성자가 아닐 때만 표시, absolute positioning으로 주변 레이아웃에 영향 없음)
  const reportButton = !isAuthor
    ? `<button class="report-comment-btn hidden absolute top-12 left-0 z-10 px-3 py-1.5 text-xs bg-red-600 hover:bg-red-500 text-white rounded-lg shadow-lg transition-all whitespace-nowrap" data-comment-id="${commentId}">신고하기</button>`
    : '';

  return `
    <div class="py-3 comment-item" data-comment-id="${commentId}">
      <div class="flex items-start space-x-3">
        <div class="flex-shrink-0 relative">
          ${avatarHTML}
          ${reportButton}
        </div>
        <div class="flex-1 min-w-0">
          <div class="flex items-center justify-between mb-2">
            <div class="flex items-center">
              <span class="font-semibold text-white text-sm">${nickname}</span>
              ${actionButtons}
            </div>
            <span class="text-xs text-gray-400">${createdAt}</span>
          </div>
          <p class="comment-content text-sm text-gray-200 whitespace-pre-wrap break-words">${content}</p>
          <div class="comment-edit-form hidden mt-2">
            <textarea class="edit-textarea w-full px-3 py-2 bg-[#2d2d3d] border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500 focus:ring-opacity-20 transition-all duration-300 text-sm resize-none" rows="3" maxlength="500"></textarea>
            <div class="flex items-center justify-end space-x-2 mt-2">
              <button class="cancel-edit-btn px-3 py-1 text-xs bg-gray-600 hover:bg-gray-500 text-white rounded transition-colors">취소</button>
              <button class="save-edit-btn px-3 py-1 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors">저장</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

/**
 * 댓글 제출
 */
async function submitComment() {
  const commentInput = document.getElementById('commentInput');
  const submitCommentBtn = document.getElementById('submitCommentBtn');

  if (!commentInput || !submitCommentBtn) {
    return;
  }

  const content = commentInput.value.trim();

  if (!content) {
    alert('댓글 내용을 입력해주세요.');
    return;
  }

  if (content.length > 500) {
    alert('댓글은 최대 500자까지 작성할 수 있습니다.');
    return;
  }

  // currentQuizId가 없으면 세션 데이터에서 다시 가져오기
  if (!currentQuizId) {
    const sessionId = window.location.pathname.split('/').pop();
    try {
      const response = await fetch(`/game/session/${sessionId}`, { credentials: 'include' });
      if (response.ok) {
        const sessionData = await response.json();
        currentQuizId = sessionData.quiz?._id;
        if (!currentQuizId) {
          alert('퀴즈 정보를 찾을 수 없습니다.');
          return;
        }
      } else {
        alert('퀴즈 정보를 불러올 수 없습니다.');
        return;
      }
    } catch (error) {
      alert('퀴즈 정보를 불러올 수 없습니다.');
      return;
    }
  }

  // currentUser가 없으면 실시간으로 다시 가져오기
  if (!currentUser) {
    try {
      const response = await fetch('/auth/me', { credentials: 'include' });
      if (response.ok) {
        currentUser = await response.json();
      } else {
        alert('로그인이 필요합니다.');
        window.location.href = '/login';
        return;
      }
    } catch (error) {
      alert('로그인이 필요합니다.');
      window.location.href = '/login';
      return;
    }
  }

  // 버튼 비활성화 및 로딩 상태
  submitCommentBtn.disabled = true;
  const originalText = submitCommentBtn.innerHTML;
  submitCommentBtn.innerHTML = '<svg class="animate-spin h-4 w-4 mx-auto" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" fill="none"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>';

  try {
    const response = await fetch(`/api/quiz/${currentQuizId}/comment`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify({ content }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.message || '댓글 작성에 실패했습니다.');
    }

    const data = await response.json();

    if (data.success) {
      // 입력 필드 초기화
      commentInput.value = '';

      // 첫 페이지로 돌아가서 댓글 목록 새로고침
      currentPage = 1;
      await loadComments();

      // 성공 메시지 (선택사항)
      // alert('댓글이 작성되었습니다.');
    }
  } catch (error) {
    console.error('댓글 작성 오류:', error);
    alert(error.message);
  } finally {
    // 버튼 원상복구
    submitCommentBtn.innerHTML = originalText;
    submitCommentBtn.disabled = false;
  }
}

/**
 * 댓글 수정 폼 표시
 * @param {string} commentId - 댓글 ID
 */
function showEditForm(commentId) {
  const commentItem = document.querySelector(`.comment-item[data-comment-id="${commentId}"]`);
  if (!commentItem) return;

  const commentContent = commentItem.querySelector('.comment-content');
  const editForm = commentItem.querySelector('.comment-edit-form');
  const editTextarea = editForm.querySelector('.edit-textarea');

  // 현재 댓글 내용을 textarea에 설정 (HTML 디코딩)
  const currentText = commentContent.textContent;
  editTextarea.value = currentText;

  // 댓글 내용 숨기고 수정 폼 표시
  commentContent.classList.add('hidden');
  editForm.classList.remove('hidden');
  editTextarea.focus();
}

/**
 * 댓글 수정 폼 숨기기
 * @param {HTMLElement} commentItem - 댓글 아이템 요소
 */
function hideEditForm(commentItem) {
  const commentContent = commentItem.querySelector('.comment-content');
  const editForm = commentItem.querySelector('.comment-edit-form');

  commentContent.classList.remove('hidden');
  editForm.classList.add('hidden');
}

/**
 * 댓글 수정 저장
 * @param {string} commentId - 댓글 ID
 * @param {HTMLElement} commentItem - 댓글 아이템 요소
 */
async function saveEditComment(commentId, commentItem) {
  const editTextarea = commentItem.querySelector('.edit-textarea');
  const content = editTextarea.value.trim();

  if (!content) {
    alert('댓글 내용을 입력해주세요.');
    return;
  }

  if (content.length > 500) {
    alert('댓글은 최대 500자까지 작성할 수 있습니다.');
    return;
  }

  try {
    const response = await fetch(`/api/quiz/${currentQuizId}/comment/${commentId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify({ content }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.message || '댓글 수정에 실패했습니다.');
    }

    const data = await response.json();

    if (data.success) {
      // 첫 페이지로 돌아가서 댓글 목록 새로고침
      currentPage = 1;
      await loadComments();
    }
  } catch (error) {
    console.error('댓글 수정 오류:', error);
    alert(error.message);
  }
}

/**
 * 댓글 삭제
 * @param {string} commentId - 댓글 ID
 */
async function deleteComment(commentId) {
  if (!confirm('정말로 이 댓글을 삭제하시겠습니까?')) {
    return;
  }

  try {
    const response = await fetch(`/api/quiz/${currentQuizId}/comment/${commentId}`, {
      method: 'DELETE',
      credentials: 'include',
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.message || '댓글 삭제에 실패했습니다.');
    }

    const data = await response.json();

    if (data.success) {
      // 첫 페이지로 돌아가서 댓글 목록 새로고침
      currentPage = 1;
      await loadComments();
    }
  } catch (error) {
    console.error('댓글 삭제 오류:', error);
    alert(error.message);
  }
}

/**
 * 댓글 신고
 * @param {string} commentId - 댓글 ID
 */
async function reportComment(commentId) {
  // 신고 사유 선택
  const reason = prompt(
    '신고 사유를 선택해주세요:\n\n' +
    '1. 스팸\n' +
    '2. 욕설/비방\n' +
    '3. 부적절한 내용\n' +
    '4. 기타\n\n' +
    '번호를 입력하세요 (1-4):'
  );

  if (!reason) return;

  const reasonMap = {
    '1': 'spam',
    '2': 'abuse',
    '3': 'inappropriate',
    '4': 'other'
  };

  const reasonKey = reasonMap[reason.trim()];
  if (!reasonKey) {
    alert('올바른 번호를 입력해주세요 (1-4)');
    return;
  }

  let description = '';
  if (reasonKey === 'other') {
    description = prompt('신고 사유를 간단히 설명해주세요 (최대 200자):') || '';
    if (description.length > 200) {
      alert('신고 사유는 최대 200자까지 입력할 수 있습니다.');
      return;
    }
  }

  if (!confirm('정말로 이 댓글을 신고하시겠습니까?')) {
    return;
  }

  try {
    const response = await fetch(`/api/quiz/${currentQuizId}/comment/${commentId}/report`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify({
        reason: reasonKey,
        description,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.message || '댓글 신고에 실패했습니다.');
    }

    const data = await response.json();

    if (data.success) {
      alert('댓글이 신고되었습니다.');
      // 신고 버튼 숨기기
      const commentItem = document.querySelector(`.comment-item[data-comment-id="${commentId}"]`);
      const reportBtn = commentItem?.querySelector('.report-comment-btn');
      if (reportBtn) {
        reportBtn.classList.add('hidden');
      }
    }
  } catch (error) {
    console.error('댓글 신고 오류:', error);
    alert(error.message);
  }
}

/**
 * HTML 이스케이프 (XSS 방지)
 * @param {string} text
 * @returns {string}
 */
function escapeHtml(text) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, m => map[m]);
}

/**
 * 날짜 포맷팅
 * @param {string|Date} date
 * @returns {string}
 */
function formatDate(date) {
  const now = new Date();
  const commentDate = new Date(date);
  const diff = now - commentDate;

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) {
    return '방금 전';
  } else if (minutes < 60) {
    return `${minutes}분 전`;
  } else if (hours < 24) {
    return `${hours}시간 전`;
  } else if (days < 7) {
    return `${days}일 전`;
  } else {
    const year = commentDate.getFullYear();
    const month = String(commentDate.getMonth() + 1).padStart(2, '0');
    const day = String(commentDate.getDate()).padStart(2, '0');
    return `${year}.${month}.${day}`;
  }
}

// Window 객체에 노출 (HTML에서 직접 호출 가능하도록)
window.submitQuizComment = submitComment;
