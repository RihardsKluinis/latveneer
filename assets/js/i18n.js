
function loadLanguage(lang) {
    fetch(`assets/lang/${lang}.json`)
      .then(response => response.json())
      .then(data => {
        document.querySelectorAll('[data-i18n]').forEach(el => {
          const keys = el.getAttribute('data-i18n').split('.');
          let value = data;
          keys.forEach(k => value = value[k]);
          if (value) el.textContent = value;
        });
      });
  }
  
  document.addEventListener("DOMContentLoaded", () => {
    const lang = localStorage.getItem('lang') || 'en';
    loadLanguage(lang);
  });
  
  function switchLanguage(lang) {
    localStorage.setItem('lang', lang);
    loadLanguage(lang);
  }
  