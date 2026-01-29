// public/js/login.js

// DOM이 로드된 후 실행
document.addEventListener('DOMContentLoaded', function() {
    // URL 파라미터 처리
    handleUrlParameters();
    
    // 로그인 폼 이벤트 리스너
    setupLoginForm();
});

// URL 파라미터에서 에러/성공 메시지 처리
function handleUrlParameters() {
    const urlParams = new URLSearchParams(window.location.search);
    const error = urlParams.get('error');
    const message = urlParams.get('message');
    const email = urlParams.get('email');
    const suggestSignup = urlParams.get('suggest_signup');
    
    const alertContainer = document.getElementById('alertContainer');
    
    // 성공 메시지 처리
    if (message) {
        showAlert('success', decodeURIComponent(message));
        return;
    }
    
    // 에러 메시지 처리
    if (error) {
        let errorMessage = '';
        
        switch(error) {
            case 'different_provider':
                errorMessage = `이메일 ${email}은 다른 방법으로 가입된 계정입니다. 일반 로그인을 시도해주세요.`;
                break;
            case 'not_registered':
                errorMessage = '가입되지 않은 계정입니다. ';
                if (suggestSignup) {
                    errorMessage += '<a href="/signup">회원가입</a>을 먼저 진행해주세요.';
                }
                break;
            case 'auth_failed':
                errorMessage = '로그인 처리 중 오류가 발생했습니다. 다시 시도해주세요.';
                break;
            case 'session_expired':
                errorMessage = '세션이 만료되었습니다. 다시 로그인해주세요.';
                break;
            case 'account_deleted':
                errorMessage = '탈퇴한 계정입니다. 로그인할 수 없습니다.<br>작성하신 콘텐츠는 6개월간 보관 후 완전히 삭제됩니다.';
                break;
            default:
                errorMessage = '알 수 없는 오류가 발생했습니다.';
        }
        
        showAlert('error', errorMessage);
    }
}

// 알림 메시지 표시 함수
function showAlert(type, message) {
    const alertContainer = document.getElementById('alertContainer');
    const alertClass = type === 'success' ? 'alert-success' : 
                     type === 'info' ? 'alert-info' : 'alert-error';
    
    alertContainer.innerHTML = `<div class="alert ${alertClass}">${message}</div>`;
    
    // 성공 메시지는 3초 후 자동 제거
    if (type === 'success') {
        setTimeout(() => {
            alertContainer.innerHTML = '';
        }, 3000);
    }
}

// 로그인 폼 설정
function setupLoginForm() {
    const loginForm = document.getElementById('loginForm');
    const submitButton = loginForm.querySelector('button[type="submit"]');
    
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        // 로딩 상태 시작
        setLoadingState(true);
        
        try {
            const formData = new FormData(e.target);
            const data = Object.fromEntries(formData.entries());
            
            // 기본 유효성 검사
            if (!validateLoginForm(data)) {
                setLoadingState(false);
                return;
            }
            
            const response = await fetch('/auth/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(data),
                credentials: 'include'
            });
            
            const result = await response.json();

            if (response.ok) {
                // 로그인 성공
                showAlert('success', '로그인 성공! 메인 페이지로 이동합니다...');

                // 사용자 정보 저장 (선택사항)
                if (result.username) {
                    localStorage.setItem('username', result.username);
                }
                if (result.userId) {
                    localStorage.setItem('userId', result.userId);
                }

                // 1초 후 리다이렉트
                setTimeout(() => {
                    window.location.href = '/';
                }, 1000);

            } else {
                // 로그인 실패
                // 정지된 계정인 경우 alert로 명확하게 표시
                if (result.isSuspended) {
                    const suspendMessage = result.suspendedUntil
                        ? `계정이 ${new Date(result.suspendedUntil).toLocaleDateString('ko-KR')}까지 정지되었습니다.`
                        : '계정이 영구 정지되었습니다.';

                    alert(`${suspendMessage}\n\n사유: ${result.suspendReason || '관리자 조치'}`);

                    // alert 확인 후 메인 페이지로 리다이렉트
                    window.location.href = '/';
                } else {
                    showAlert('error', result.message || '로그인에 실패했습니다.');
                    setLoadingState(false);
                }
            }
            
        } catch (err) {
            console.error('로그인 에러:', err);
            showAlert('error', '네트워크 오류가 발생했습니다. 다시 시도해주세요.');
            setLoadingState(false);
        }
    });
}

// 폼 유효성 검사
function validateLoginForm(data) {
    if (!data.email || !data.email.trim()) {
        showAlert('error', '이메일을 입력해주세요.');
        return false;
    }
    
    if (!data.password || !data.password.trim()) {
        showAlert('error', '비밀번호를 입력해주세요.');
        return false;
    }
    
    // 이메일 형식 간단 검증
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(data.email)) {
        showAlert('error', '올바른 이메일 형식을 입력해주세요.');
        return false;
    }
    
    return true;
}

// 로딩 상태 관리
function setLoadingState(loading) {
    const form = document.getElementById('loginForm');
    const submitButton = form.querySelector('button[type="submit"]');
    const socialButtons = document.querySelectorAll('.social-login-group a');
    
    if (loading) {
        form.classList.add('loading');
        submitButton.disabled = true;
        submitButton.textContent = '로그인 중...';
        
        // 소셜 로그인 버튼도 비활성화
        socialButtons.forEach(btn => {
            btn.style.pointerEvents = 'none';
            btn.style.opacity = '0.7';
        });
    } else {
        form.classList.remove('loading');
        submitButton.disabled = false;
        submitButton.textContent = '로그인';
        
        // 소셜 로그인 버튼 재활성화
        socialButtons.forEach(btn => {
            btn.style.pointerEvents = '';
            btn.style.opacity = '';
        });
    }
}

// Enter 키 처리 (이미 form submit으로 처리되지만 명시적으로)
document.addEventListener('keypress', function(e) {
    if (e.key === 'Enter') {
        const loginForm = document.getElementById('loginForm');
        if (document.activeElement.closest('#loginForm')) {
            loginForm.dispatchEvent(new Event('submit'));
        }
    }
});