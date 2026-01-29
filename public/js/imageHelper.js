// 이미지 URL 헬퍼 (Base64 또는 S3 URL 모두 지원)

/**
 * 이미지 소스를 반환 (Base64 또는 S3 URL)
 * @param {string} imageData - Base64 또는 S3 URL
 * @returns {string} 이미지 src
 */
function getImageSrc(imageData) {
  if (!imageData) {
    return ''; // 빈 문자열 반환
  }

  // 이미 URL이거나 Base64면 그대로 반환
  if (imageData.startsWith('http') || imageData.startsWith('data:image')) {
    return imageData;
  }

  // 혹시 모를 상황 대비 (그냥 반환)
  return imageData;
}

/**
 * 이미지 엘리먼트 생성
 * @param {string} imageData - Base64 또는 S3 URL
 * @param {string} altText - alt 텍스트
 * @param {string} className - CSS 클래스
 * @returns {string} HTML 문자열
 */
function createImageElement(imageData, altText = '', className = '') {
  if (!imageData) {
    return `<div class="${className} bg-gray-200 flex items-center justify-center">이미지 없음</div>`;
  }

  const src = getImageSrc(imageData);
  return `<img src="${src}" alt="${altText}" class="${className}" onerror="this.onerror=null; this.src=''; this.alt='이미지 로드 실패'">`;
}

// 전역으로 export (CommonJS 또는 전역 스코프)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getImageSrc, createImageElement };
} else if (typeof window !== 'undefined') {
  window.getImageSrc = getImageSrc;
  window.createImageElement = createImageElement;
}
