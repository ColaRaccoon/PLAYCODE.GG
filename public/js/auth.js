// public/js/navbar.js (또는 유틸 파일)
// 401 에러 시 자동으로 토큰 재발급을 시도하는 fetch 래퍼 함수
async function fetchWithAuth(url, options = {}) {
    options.credentials = 'include';

    let response = await fetch(url, options);

    // 401 또는 403 에러 시 토큰 재발급 시도
    if (response.status === 401 || response.status === 403) {
        console.log('인증 오류. 토큰 재발급을 시도합니다.');

        const refreshResponse = await fetch('/auth/refresh', {
            method: 'POST',
            credentials: 'include'
        });

        if (refreshResponse.ok) {
            console.log('토큰 재발급 성공. 원래 요청을 재시도합니다.');
            response = await fetch(url, options);
        } else {
            console.log('리프레시 토큰 만료. 로그아웃 처리합니다.');
            alert('세션이 만료되었습니다. 다시 로그인해주세요.');
            window.location.href = '/login';
            return refreshResponse;
        }
    }

    return response;
}

async function getUserData() {
    try {
        const response = await fetchWithAuth('/my-info');
        if (response.ok) {
            const user = await response.json();
            return user && user.nickname ? user : null;
        }
        return null;
    } catch (err) {
        console.error('유저 정보 불러오기 실패:', err);
        return null;
    }
}

export { getUserData, fetchWithAuth };