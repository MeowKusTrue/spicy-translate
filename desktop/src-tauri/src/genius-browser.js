// Runs only inside the separate Genius WebView; no project or filesystem commands are granted here.
(() => {
  if (window.top !== window || location.origin !== 'https://genius.com') return;
  const mount = () => {
    if (document.getElementById('spicy-genius-import')) return;
    const panel = document.createElement('div'); panel.id = 'spicy-genius-import';
    Object.assign(panel.style,{position:'fixed',bottom:'16px',right:'16px',zIndex:'2147483647',padding:'12px',borderRadius:'10px',background:'#171a18',color:'#f0f2eb',font:'14px Segoe UI,sans-serif',boxShadow:'0 4px 24px #0008',maxWidth:'350px'});
    const hint = document.createElement('div'); hint.textContent = 'Открой песню. Если сайт просит проверку — пройди её здесь.'; hint.style.marginBottom = '8px';
    const button = document.createElement('button'); button.textContent = 'Взять текст в Spicy Translate';
    Object.assign(button.style,{padding:'9px 12px',border:'0',borderRadius:'6px',background:'#d4f598',color:'#1a2510',cursor:'pointer'});
    button.onclick = async () => {
      const blocks = [...document.querySelectorAll('[data-lyrics-container="true"]')];
      const text = blocks.map(el => { const clone = el.cloneNode(true); clone.querySelectorAll('[data-exclude-from-selection],script,style').forEach(x=>x.remove()); clone.querySelectorAll('br').forEach(x=>x.replaceWith(document.createTextNode('\n'))); clone.querySelectorAll('div,p').forEach(x=>x.appendChild(document.createTextNode('\n'))); return clone.textContent || ''; }).join('\n').trim();
      if (!text || !location.pathname.endsWith('-lyrics')) { hint.textContent = 'На этой странице текст песни ещё не загружен. Открой песню и дождись текста.'; return; }
      button.disabled = true;
      try { await window.__TAURI_INTERNALS__.invoke('genius_capture',{text,url:location.href,title:document.title}); hint.textContent = 'Текст передан в сверку. Изменения применяются в редакторе отдельно.'; }
      catch(e) { hint.textContent = 'Не удалось передать текст: '+String(e); }
      finally { button.disabled = false; }
    };
    panel.append(hint,button); document.body.appendChild(panel);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',mount,{once:true}); else mount();
})();
