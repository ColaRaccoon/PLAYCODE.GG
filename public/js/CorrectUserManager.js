/**
 * 정답자 박스 통합 관리 시스템
 */
const CorrectUserManager = {
  config: {
    boxId: 'correctUserBox',
    emoji: '🎯',
    baseText: '정답자',
    separator: ', ',
    styles: {
      color: 'blue',
      fontWeight: 'bold',
      fontSize: '16px',
      margin: '10px 0',
      padding: '8px',
      backgroundColor: '#f0f8ff',
      border: '1px solid #4169E1',
      borderRadius: '4px'
    }
  },

  getUsers() {
    const correctBox = document.getElementById(this.config.boxId);
    if (!correctBox) return [];
    
    return this.getCurrentUsers(correctBox);
  },

  getOrCreateBox() {
    const box = document.getElementById('questionBox');
    if (!box) return null;

    let correctBox = document.getElementById(this.config.boxId);
    
    if (!correctBox) {
      correctBox = document.createElement('p');
      correctBox.id = this.config.boxId;
      Object.assign(correctBox.style, this.config.styles);
      box.appendChild(correctBox);
    }
    
    return correctBox;
  },

  getCurrentUsers(correctBox) {
    if (!correctBox || !correctBox.textContent) return [];
    
    const text = correctBox.textContent;
    const prefix = `${this.config.emoji} ${this.config.baseText}: `;
    
    if (!text.includes(prefix)) return [];
    
    return text
      .replace(prefix, '')
      .split(this.config.separator)
      .map(s => s.trim())
      .filter(Boolean);
  },

  updateBox(correctBox, users) {
    if (!correctBox || !Array.isArray(users)) return;
    
    const text = users.length > 0 
      ? `${this.config.emoji} ${this.config.baseText}: ${users.join(this.config.separator)}`
      : '';
      
    correctBox.textContent = text;
    correctBox.style.display = users.length > 0 ? 'block' : 'none';
  },

  addUser(username) {
    if (!username) return;
    
    const correctBox = this.getOrCreateBox();
    if (!correctBox) return;
    
    const currentUsers = this.getCurrentUsers(correctBox);
    
    if (!currentUsers.includes(username)) {
      currentUsers.push(username);
      this.updateBox(correctBox, currentUsers);
    }
  },

  setUsers(userList) {
    if (!Array.isArray(userList)) return;
    
    const correctBox = this.getOrCreateBox();
    if (!correctBox) return;
    
    this.updateBox(correctBox, userList);
  },

  clear() {
    const correctBox = document.getElementById(this.config.boxId);
    if (correctBox) {
      correctBox.remove();
    }
  },

  restoreFromData(correctUsernames, suffix = '') {
    if (!Array.isArray(correctUsernames) || correctUsernames.length === 0) return;
    
    const correctBox = this.getOrCreateBox();
    if (!correctBox) return;
    
    const text = suffix 
      ? `${this.config.emoji} ${this.config.baseText} ${suffix}: ${correctUsernames.join(this.config.separator)}`
      : `${this.config.emoji} ${this.config.baseText}: ${correctUsernames.join(this.config.separator)}`;
    correctBox.textContent = text;
  }
};