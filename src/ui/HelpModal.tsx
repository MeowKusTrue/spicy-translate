import { S, emit } from '../state.ts';

const close = () => { S.help = false; emit(); };

export function HelpModal() {
  return <div className="modal" id="help" hidden={!S.help} onClick={e => { if ((e.target as Element).id === 'help') close(); }}>
    <div className="help">
      <button className="sm ic close" id="helpClose" title="Закрыть (Esc)" onClick={close}>✕</button>
      <h3>Как размечать слова</h3>
      <svg viewBox="0 0 560 96" style={{ width: '100%', display: 'block' }} aria-label="Схема: F начало, G следующее, H конец">
        <line x1="10" y1="74" x2="550" y2="74" stroke="rgba(255,255,255,.2)" />
        <rect x="50" y="34" width="120" height="30" rx="6" fill="rgba(182,156,255,.3)" stroke="#b69cff" /><text x="110" y="54" fill="#fff" fontSize="13" fontWeight="700" textAnchor="middle">ты</text>
        <rect x="170" y="34" width="150" height="30" rx="6" fill="rgba(182,156,255,.3)" stroke="#b69cff" /><text x="245" y="54" fill="#fff" fontSize="13" fontWeight="700" textAnchor="middle">моя</text>
        <text x="355" y="54" fill="rgba(255,255,255,.45)" fontSize="12" textAnchor="middle">пауза</text>
        <rect x="390" y="34" width="130" height="30" rx="6" fill="rgba(182,156,255,.3)" stroke="#b69cff" /><text x="455" y="54" fill="#fff" fontSize="13" fontWeight="700" textAnchor="middle">звезда</text>
        <g fontSize="12" fontWeight="800" fontFamily="ui-monospace,monospace">
          <line x1="50" y1="14" x2="50" y2="74" stroke="#6ee7b7" strokeWidth="2" /><text x="44" y="12" fill="#6ee7b7">F</text>
          <line x1="170" y1="14" x2="170" y2="74" stroke="#b69cff" strokeWidth="2" /><text x="164" y="12" fill="#b69cff">G</text>
          <line x1="320" y1="14" x2="320" y2="74" stroke="#ff7ac8" strokeWidth="2" /><text x="314" y="12" fill="#ff7ac8">H</text>
          <line x1="390" y1="14" x2="390" y2="74" stroke="#6ee7b7" strokeWidth="2" /><text x="384" y="12" fill="#6ee7b7">F</text>
          <line x1="520" y1="14" x2="520" y2="74" stroke="#ff7ac8" strokeWidth="2" /><text x="514" y="12" fill="#ff7ac8">H</text>
        </g>
      </svg>
      <ol>
        <li>Кликни первое слово строки и нажми <kbd>Space</kbd>.</li>
        <li><kbd className="f">F</kbd> <b>Начало</b> — певец начал слово.</li>
        <li><kbd className="g">G</kbd> <b>Следующее</b> — началось следующее слово. Этим проходишь всю строку.</li>
        <li><kbd className="h">H</kbd> <b>Конец</b> — только перед паузой или в конце строки. После паузы снова <kbd className="f">F</kbd>.</li>
        <li>Промахнулся — <kbd>Ctrl+Z</kbd> или поправь блок мышью на волне: тащи блок или его край.</li>
      </ol>
      <details><summary>Все клавиши и мышь</summary>
        <p><kbd>A</kbd>/<kbd>D</kbd> слово назад/вперёд · <kbd>←</kbd>/<kbd>→</kbd> ±5 с (Shift ±1) · <kbd>[</kbd> <kbd>]</kbd> <kbd>'</kbd> скорость · <kbd>L</kbd> крутить строку · <kbd>R</kbd> к началу строки · <kbd>,</kbd> <kbd>.</kbd> сдвиг слова ±10 мс (Shift ±50) · <kbd>Del</kbd> сбросить слово · <kbd>M</kbd> склеить · <kbd>U</kbd> слоги / разделить · <kbd>N</kbd> магнит · <kbd>Ctrl+Z</kbd> / <kbd>Ctrl+Shift+Z</kbd></p>
        <p><b>Дорожки.</b> Сверху — основная строка, под ней — бэк, ниже — волна и строки трека. Клик по дорожке (или <kbd>B</kbd>) переключает основу/бэк, <kbd>T</kbd> — перевод/оригинал. <b>Двойной клик</b>: по слову — исправить его (пробел добавит слова, пусто — удалит), по пустому месту строки — вписать/исправить всю строку этой дорожки, там, где строк нет, — новая строка (на дорожке «бэк» — отдельный бэк). <kbd>E</kbd> — править выбранное слово. <b>Копии как в монтажке:</b> <kbd>Alt</kbd>+тащи слово — копия (можно бросить и на другую дорожку), <kbd>Alt</kbd>+тащи строку в полосе строк — копия всей строки со всеми словами; <kbd>Shift</kbd>+тащи слово — двигать его одно, без склеенных соседей; <kbd>Ctrl+C</kbd> / <kbd>Ctrl+V</kbd> — скопировать выделенные строки и вставить у курсора. <b>Тайминг строки на другую:</b> <kbd>Alt</kbd>+тащи строку в полосе строк и брось на другую строку (подсветится жёлтым) — у неё станет тот же ритм, слова её; или <kbd>Ctrl+Shift+C</kbd> на размеченной строке → выдели строки → <kbd>Ctrl+Shift+V</kbd>; ПКМ по строке в полосе — меню (копировать / вставить / очистить тайминг, дублировать, удалить). <kbd>C</kbd> — разметка строки переносится на все строки с таким же текстом (припев), пунктиром — проверь на слух. Полоса строк внизу: тащи строку — едет целиком со всеми словами. Тайминги неизменённых слов при правке текста сохраняются.</p>
        <p><b>Сомнительные слова</b> авто-тайминга отмечены оранжевым «?»: <kbd>Q</kbd> — к следующему (и послушать), <kbd>Shift</kbd>+<kbd>Q</kbd> — назад; тронул слово — оно проверено.</p>
        <p><b>Выбор как в проводнике:</b> тащи по пустому месту — рамка выбирает слова на дорожках и строки в полосе строк (<kbd>Ctrl</kbd> — добавить к выбору, <kbd>Ctrl</kbd>/<kbd>Shift</kbd>+клик по строке — по одной / диапазоном). Тащи любой выбранный блок — едут все (<kbd>Alt</kbd> — копии), <kbd>Esc</kbd> — снять выбор. <kbd>Alt</kbd>+тащи по пустой дорожке — нарисовать выбранное слово.</p>
        <p>Волна: тащи блок или край · белая перемычка = края склеены и двигаются вместе (<kbd>Alt</kbd> — отцепить, <kbd>Ctrl</kbd> — без магнита) · верхняя полоса: зажми и проведи = «нарисовать» слово · внизу тащи = листать · <kbd>Ctrl</kbd>+колесо = зум · ПКМ по слову = проиграть. Пунктир = расставлено автоматически, ещё не проверено тобой; ✦ = долгое слово (в превью светится).</p>
        <p>Слоги: <kbd>U</kbd> делит слово, или впиши <b>|</b> в тексте перевода (кра|си|вый). Каждый слог размечается как слово.</p>
      </details>
    </div>
  </div>;
}
