// 정지 알림이 이미 표시되었는지 확인하는 플래그
let suspendAlertShownInFetch = false;

// fetchWithAuth를 export로 변경
export async function fetchWithAuth(url, options = {}) {
    options.credentials = 'include';

    try {
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
                throw new Error('Token refresh failed');
            }
        }

        // 403 에러인 경우 정지/탈퇴 여부 확인
        if (response.status === 403) {
            // 이미 alert를 표시했다면 중복 방지
            if (suspendAlertShownInFetch) {
                throw new Error('Already handled');
            }

            const data = await response.json();

            // 정지된 계정
            if (data.isSuspended) {
                suspendAlertShownInFetch = true; // 플래그 설정

                const suspendMessage = data.suspendedUntil
                    ? `계정이 ${new Date(data.suspendedUntil).toLocaleDateString('ko-KR')}까지 정지되었습니다.`
                    : '계정이 영구 정지되었습니다.';

                // alert 표시 (동기적으로 사용자가 확인할 때까지 대기)
                alert(`${suspendMessage}\n\n사유: ${data.suspendReason || '관리자 조치'}`);

                // 로그아웃 처리
                await fetch('/auth/logout', {
                    method: 'POST',
                    credentials: 'include'
                });

                // 메인 페이지로 리다이렉트
                window.location.href = '/';
                throw new Error('Account suspended');
            }

            // 기타 403 에러 (탈퇴한 계정 등)
            if (data.message) {
                suspendAlertShownInFetch = true; // 플래그 설정

                // alert 표시
                alert(data.message);

                // 로그아웃 처리
                await fetch('/auth/logout', {
                    method: 'POST',
                    credentials: 'include'
                });

                // 메인 페이지로 리다이렉트
                window.location.href = '/';
                throw new Error('Access forbidden');
            }
        }

        return response;
    } catch (error) {
        console.error('fetchWithAuth 에러:', error);
        throw error;
    }
}

let quizInitTitleImageFile = null; // File 객체 저장

// 퀴즈 초기 설정 모달 열기
function openQuizInitModal() {
    const modal = document.getElementById('quizInitModal');
    if (modal) {
        modal.classList.remove('hidden');
        document.body.style.overflow = 'hidden';

        // 입력 필드 초기화
        document.getElementById('quizInitTitle').value = '';
        document.getElementById('quizInitDescription').value = '';
        document.getElementById('quizInitTitleImageInput').value = '';
        document.getElementById('quizInitTitleImagePreview').style.display = 'none';
        document.getElementById('quizInitImagePreviewContainer').classList.add('hidden');
        quizInitTitleImageFile = null;
    }
}

// 퀴즈 초기 설정 모달 닫기
function closeQuizInitModal() {
    const modal = document.getElementById('quizInitModal');
    if (modal) {
        // ObjectURL 메모리 해제
        const preview = document.getElementById('quizInitTitleImagePreview');
        if (preview && preview.src && preview.src.startsWith('blob:')) {
            URL.revokeObjectURL(preview.src);
        }

        modal.classList.add('hidden');
        document.body.style.overflow = 'auto';
    }
}

// 모달 외부 클릭 시 닫기
function handleQuizInitModalClick(event) {
    if (event.target.id === 'quizInitModal') {
        closeQuizInitModal();
    }
}

// 이미지 리사이즈 함수를 export로 변경
// Blob으로 리사이징 (Presigned URL용) - 1MB 제한
export async function resizeImageToBlob(file, maxKB = 1024, minKB = 100) {
    return new Promise((resolve, reject) => {
        // 파일 크기 체크
        const sizeMB = file.size / (1024 * 1024);
        if (sizeMB > 10) {
            return reject(new Error('10MB를 초과한 이미지는 업로드할 수 없습니다.'));
        }

        // 30초 타임아웃 설정 (큰 이미지 처리 시간 제한)
        const timeout = setTimeout(() => {
            reject(new Error('이미지 처리 시간 초과 (30초). 더 작은 이미지를 사용해주세요.'));
        }, 30000);

        const reader = new FileReader();

        // FileReader 에러 핸들러
        reader.onerror = () => {
            clearTimeout(timeout);
            reject(new Error('파일 읽기 실패. 다른 이미지를 선택해주세요.'));
        };

        reader.onload = async (e) => {
            const img = new Image();

            // Image 로드 에러 핸들러
            img.onerror = () => {
                clearTimeout(timeout);
                reject(new Error('이미지 로드 실패. 올바른 이미지 파일인지 확인해주세요.'));
            };

            img.onload = async () => {
                try {
                    // 해상도 체크 및 리사이징 (최대 4096x4096)
                    const MAX_DIMENSION = 4096;
                    let width = img.width;
                    let height = img.height;

                    // 해상도가 너무 크면 자동으로 줄이기
                    if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
                        const ratio = Math.min(MAX_DIMENSION / width, MAX_DIMENSION / height);
                        width = Math.floor(width * ratio);
                        height = Math.floor(height * ratio);
                    }

                    const canvas = document.createElement('canvas');
                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');

                    if (!ctx) {
                        clearTimeout(timeout);
                        reject(new Error('Canvas 생성 실패. 브라우저를 다시 시작해주세요.'));
                        return;
                    }

                    ctx.drawImage(img, 0, 0, width, height);

                    // 재귀 대신 async/await 반복문 사용 (안정성 향상)
                    const createBlob = (quality) => {
                        return new Promise((resolve, reject) => {
                            canvas.toBlob((blob) => {
                                if (blob) {
                                    resolve(blob);
                                } else {
                                    reject(new Error('Blob 생성 실패'));
                                }
                            }, 'image/webp', quality);
                        });
                    };

                    let quality = 0.9;
                    let blob = null;

                    // 반복문으로 압축 (재귀 문제 해결)
                    while (quality >= 0.1) {
                        blob = await createBlob(quality);
                        const sizeKB = blob.size / 1024;

                        // 목표 크기 달성
                        if (sizeKB <= maxKB && sizeKB >= minKB) {
                            clearTimeout(timeout);
                            resolve(blob);
                            return;
                        }

                        // 너무 작으면 품질 올리기
                        if (sizeKB < minKB && quality < 0.9) {
                            quality = Math.min(0.9, quality + 0.1);
                            continue;
                        }

                        // 너무 크면 품질 낮추기
                        if (sizeKB > maxKB) {
                            quality -= 0.05;
                            continue;
                        }

                        // 조건 만족하면 반환
                        break;
                    }

                    // 최종 결과 반환
                    clearTimeout(timeout);
                    resolve(blob);

                } catch (error) {
                    clearTimeout(timeout);
                    reject(new Error(`이미지 처리 중 오류: ${error.message}`));
                }
            };

            img.src = e.target.result;
        };

        reader.readAsDataURL(file);
    });
}

// 하위 호환성을 위한 Base64 함수 (기존 코드용, 더 이상 사용 안 함)
export async function resizeImageToBase64(file, maxKB = 1024, minKB = 100) {
    const blob = await resizeImageToBlob(file, maxKB, minKB);
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

// Presigned URL로 S3에 직접 업로드
export async function uploadToS3WithPresignedUrl(file, folder, fileName) {
    try {
        // 1. 이미지 리사이징 (1MB 이하)
        const blob = await resizeImageToBlob(file, 1024, 100);

        // 2. 서버에서 Presigned URL 요청
        const presignedResponse = await fetch('/api/s3/presigned-url', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
                folder,
                fileName,
                contentType: 'image/webp'
            })
        });

        if (!presignedResponse.ok) {
            const errorData = await presignedResponse.json().catch(() => ({}));
            throw new Error(errorData.message || `업로드 URL 발급 실패 (상태 코드: ${presignedResponse.status})`);
        }

        const { uploadUrl, fileUrl } = await presignedResponse.json();

        // 3. S3에 직접 업로드
        const uploadResponse = await fetch(uploadUrl, {
            method: 'PUT',
            body: blob,
            headers: {
                'Content-Type': 'image/webp'
            }
        });

        if (!uploadResponse.ok) {
            throw new Error(`이미지 서버 업로드 실패 (상태 코드: ${uploadResponse.status}). 네트워크 연결을 확인하고 다시 시도해주세요.`);
        }

        // 4. 업로드된 파일의 URL 반환
        return fileUrl;
    } catch (error) {
        console.error('❌ S3 업로드 실패:', error);
        throw error;
    }
}

// 이미지 선택 핸들러
async function handleQuizInitImageSelect(event) {
    const file = event.target.files[0];
    if (!file) return;

    try {
        // 1. 파일 타입 검증 (이미지만 허용)
        const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];
        if (!allowedTypes.includes(file.type)) {
            alert('❌ 지원하지 않는 파일 형식입니다.\n\n지원 형식: JPEG, PNG, WebP, GIF\n현재 선택된 파일: ' + (file.type || '알 수 없음'));
            event.target.value = ''; // 파일 선택 초기화
            return;
        }

        // 2. 파일 크기 초기 검증 (10MB 제한)
        const sizeMB = file.size / (1024 * 1024);
        if (sizeMB > 10) {
            alert(`❌ 파일 크기가 너무 큽니다.\n\n최대 허용 크기: 10MB\n현재 파일 크기: ${sizeMB.toFixed(2)}MB\n\n더 작은 이미지를 선택해주세요.`);
            event.target.value = ''; // 파일 선택 초기화
            return;
        }

        // 3. 파일 객체 저장 (나중에 Presigned URL로 업로드)
        quizInitTitleImageFile = file;

        // 4. 미리보기용 URL 생성 (Base64 대신 ObjectURL 사용 - 더 빠름!)
        const preview = document.getElementById('quizInitTitleImagePreview');
        const container = document.getElementById('quizInitImagePreviewContainer');

        // 이전 ObjectURL이 있으면 메모리 해제
        if (preview.src && preview.src.startsWith('blob:')) {
            URL.revokeObjectURL(preview.src);
        }

        preview.src = URL.createObjectURL(file);
        preview.style.display = 'block';
        container.classList.remove('hidden');

    } catch (err) {
        alert('❌ 이미지 처리 실패\n\n' + err.message);
        event.target.value = ''; // 파일 선택 초기화
        quizInitTitleImageFile = null;
    }
}

// 퀴즈 생성 함수
async function createQuizFromModal() {
    const title = document.getElementById('quizInitTitle').value.trim();
    const description = document.getElementById('quizInitDescription').value.trim();

    if (!title) {
        alert('퀴즈 제목을 입력하세요.');
        return;
    }

    if (!quizInitTitleImageFile) {
        alert('대표 이미지를 업로드하세요.');
        return;
    }

    const createBtn = document.getElementById('quizInitCreateBtn');
    const originalText = createBtn.innerHTML;
    createBtn.disabled = true;
    createBtn.innerHTML = '<div class="inline-flex items-center"><svg class="animate-spin h-5 w-5 mr-2" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" fill="none"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>생성 중...</div>';

    try {
        // 1단계: 퀴즈 기본 정보만 전송 (이미지 없이)
        const res = await fetchWithAuth('/api/quiz/init', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ title, description })
        });

        const data = await res.json();

        if (!res.ok) {
            throw new Error(data.message || '퀴즈 정보 저장 실패');
        }

        const quizId = data.quizId;

        // 2단계: Presigned URL로 썸네일 업로드
        createBtn.innerHTML = '<div class="inline-flex items-center"><svg class="animate-spin h-5 w-5 mr-2" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" fill="none"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>이미지 업로드 중...</div>';

        const thumbnailUrl = await uploadToS3WithPresignedUrl(
            quizInitTitleImageFile,
            'thumbnails',
            quizId
        );

        // 3단계: 서버에 썸네일 URL 업데이트
        const updateRes = await fetchWithAuth(`/api/quiz/${quizId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ titleImageBase64: thumbnailUrl })
        });

        if (!updateRes.ok) {
            const updateData = await updateRes.json().catch(() => ({}));
            throw new Error(updateData.message || '썸네일 정보 업데이트 실패');
        }

        // 성공 - 편집 페이지로 이동
        closeQuizInitModal();
        window.location.href = `/quiz/edit?quizId=${quizId}`;

    } catch (error) {
        console.error('퀴즈 생성 중 오류:', error);

        // 에러 타입에 따라 구체적인 메시지 표시
        let errorMessage = '❌ 퀴즈 생성 실패\n\n';

        if (error.message.includes('10MB를 초과')) {
            errorMessage += '📦 파일 크기 문제\n' + error.message;
        } else if (error.message.includes('시간 초과')) {
            errorMessage += '⏱️ 처리 시간 초과\n' + error.message;
        } else if (error.message.includes('파일 읽기 실패')) {
            errorMessage += '📄 파일 읽기 오류\n' + error.message;
        } else if (error.message.includes('이미지 로드 실패')) {
            errorMessage += '🖼️ 이미지 형식 오류\n' + error.message;
        } else if (error.message.includes('Canvas 생성 실패')) {
            errorMessage += '🖥️ 브라우저 오류\n' + error.message;
        } else if (error.message.includes('업로드 실패') || error.message.includes('업로드 URL')) {
            errorMessage += '☁️ 서버 업로드 오류\n' + error.message;
        } else if (error.message.includes('네트워크')) {
            errorMessage += '🌐 네트워크 오류\n' + error.message;
        } else {
            errorMessage += error.message || '알 수 없는 오류가 발생했습니다.';
        }

        alert(errorMessage);
    } finally {
        createBtn.disabled = false;
        createBtn.innerHTML = originalText;
    }
}

// 전역 함수로 등록
window.openQuizInitModal = openQuizInitModal;
window.closeQuizInitModal = closeQuizInitModal;
window.handleQuizInitModalClick = handleQuizInitModalClick;
window.handleQuizInitImageSelect = handleQuizInitImageSelect;
window.createQuizFromModal = createQuizFromModal;