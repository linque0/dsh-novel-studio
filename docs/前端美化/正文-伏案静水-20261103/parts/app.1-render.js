/* app.1-render.js — 渲染层：只读 window.NS_CONTENT，写入既有容器，不产生任何外部依赖。 */
(function () {
  'use strict';

  var C = window.NS_CONTENT || {};

  var state = {
    chapterId: C.currentId || '',
    scene: 'writing',
    mode: '',
    save: 'saved'
  };

  function $(sel, root) {
    return (root || document).querySelector(sel);
  }

  function hanLen(t) {
    if (t === null || t === undefined) return 0;
    return String(t).replace(/\s+/g, '').length;
  }

  function chapters() {
    return C && Array.isArray(C.chapters) ? C.chapters : [];
  }

  function workInfo() {
    return C.work || {};
  }

  function copyInfo() {
    return C.copy || {};
  }

  function wordsOf(ch) {
    if (!ch) return 0;
    if (typeof ch.words === 'number' && isFinite(ch.words)) return ch.words;
    var n = parseInt(ch.words, 10);
    return isNaN(n) ? 0 : n;
  }

  function currentChapter() {
    var list = chapters();
    for (var i = 0; i < list.length; i += 1) {
      if (list[i].id === state.chapterId) return list[i];
    }
    return list.length ? list[0] : null;
  }

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function setText(sel, text) {
    var node = $(sel);
    if (node) node.textContent = text === undefined || text === null ? '' : String(text);
  }

  function volumeName(volume) {
    var titles = workInfo().volumeTitles;
    var name = Array.isArray(titles) ? titles[volume - 1] : '';
    return name || '卷' + volume;
  }

  function volumeCount(groupCount) {
    var v = workInfo().volumes;
    if (typeof v === 'number' && v > 0) return v;
    if (Array.isArray(v) && v.length) return v.length;
    return groupCount;
  }

  function groupByVolume() {
    var groups = [];
    var seen = {};
    chapters().forEach(function (ch) {
      var volume = ch && ch.volume ? ch.volume : 1;
      if (!seen[volume]) {
        seen[volume] = { volume: volume, items: [] };
        groups.push(seen[volume]);
      }
      seen[volume].items.push(ch);
    });
    return groups;
  }

  function renderTree() {
    var host = $('#tree-list');
    if (!host) return;
    var groups = groupByVolume();
    var list = chapters();
    var total = 0;
    list.forEach(function (ch) { total += wordsOf(ch); });

    setText('.sp-meta', volumeCount(groups.length) + ' 卷 · ' + list.length + ' 章 · 共 ' + total + ' 字');

    host.textContent = '';
    groups.forEach(function (group) {
      var head = el('div', 'sp-vol', volumeName(group.volume) + ' · ' + group.items.length + ' 章');
      head.setAttribute('data-anchor', 'tree-volume');
      host.appendChild(head);

      group.items.forEach(function (ch) {
        var isCurrent = ch.id === state.chapterId;
        var row = el('div', 'sp-row' + (isCurrent ? ' is-current' : ''));
        row.setAttribute('data-anchor', 'tree-chapter');
        row.setAttribute('data-id', ch.id);
        row.setAttribute('role', 'button');
        row.setAttribute('tabindex', '0');

        var name = el('span', 'sp-name', ch.title || '');
        var count = el('span', 'sp-count', wordsOf(ch));
        count.setAttribute('data-anchor', 'tree-count');

        var more = el('button', 'sp-more', '⋯');
        more.type = 'button';
        more.setAttribute('data-anchor', 'tree-menu');
        more.setAttribute('data-id', ch.id);
        more.setAttribute('aria-label', '更多');

        if (isCurrent) {
          /* 朱记竖条：当前章的实体标记（锚点也落在这里，行本身仍是最普通的 tree-chapter） */
          var bar = el('span', 'sp-current-bar');
          bar.setAttribute('data-anchor', 'tree-current');
          row.appendChild(bar);
        }

        row.appendChild(name);
        row.appendChild(count);
        row.appendChild(more);
        host.appendChild(row);
      });
    });
  }

  function renderHead() {
    var ch = currentChapter();
    var words = wordsOf(ch);
    var goal = Number(C.goal) > 0 ? Number(C.goal) : 0;

    setText('.ed-title', ch ? ch.title || '' : '');
    setText('.ed-latin', ch ? ch.latin || '' : '');
    setText('.ed-goal .goal-text', words + ' / ' + goal + ' 字');

    var bar = $('.ed-goal .goal-track i');
    if (bar) {
      var ratio = goal > 0 ? words / goal : 0;
      if (ratio < 0) ratio = 0;
      if (ratio > 1) ratio = 1;
      bar.style.width = (ratio * 100).toFixed(2) + '%';
    }
  }

  function renderPaper() {
    var host = $('#tiptap');
    if (!host) return;
    host.textContent = '';

    var ch = currentChapter();
    var text = ch && ch.text ? String(ch.text) : '';

    if (!text.trim()) {
      host.appendChild(el('div', 'paper-empty', copyInfo().emptyChapter || '这一章还是空白。'));
      return;
    }

    text.split(/\n\n+/).forEach(function (seg) {
      var paragraph = seg.replace(/^\s+/, '').replace(/\s+$/, '');
      if (!paragraph) return;
      host.appendChild(el('p', '', paragraph));
    });
  }

  function renderNotes() {
    var host = $('#notes-list');
    if (!host) return;
    host.textContent = '';

    var notes = Array.isArray(C.notes) ? C.notes : [];
    notes.forEach(function (note) {
      if (!note || note.chapterId !== state.chapterId) return;
      var card = el('div', 'note');
      card.appendChild(el('div', 'note-quote', '「' + (note.quote || '') + '」'));
      card.appendChild(el('div', 'note-text', note.text || ''));
      card.appendChild(el('div', 'note-time', note.time || ''));
      host.appendChild(card);
    });
  }

  function renderAssets() {
    var quick = $('.rp-quick');
    if (quick) quick.textContent = '本章压到 1400 字：钟声要留到最后一句才响。';

    var host = $('#asset-list');
    if (!host) return;
    host.textContent = '';

    var assets = Array.isArray(C.assets) ? C.assets : [];
    assets.forEach(function (asset, index) {
      var item = el('li', 'rp-asset');
      if (index === 0) item.setAttribute('data-anchor', 'notes-asset');
      item.appendChild(el('span', '', asset && asset.title ? asset.title : ''));
      item.appendChild(el('span', 'rp-asset-meta', asset && asset.meta ? asset.meta : ''));
      host.appendChild(item);
    });
  }

  function renderHistory() {
    var host = $('#hi-list');
    if (!host) return;
    host.textContent = '';

    var history = Array.isArray(C.history) ? C.history : [];
    history.forEach(function (entry) {
      var row = el('div', 'hi-row');
      row.setAttribute('data-anchor', 'history-row');
      row.appendChild(el('span', 'hi-time', (entry && entry.time) || ''));
      row.appendChild(el('span', 'hi-diff', (entry && entry.diff) || ''));
      row.appendChild(el('span', 'hi-words', ((entry && entry.words) || 0) + ' 字'));

      var restore = el('button', 'hi-restore', '恢复');
      restore.type = 'button';
      restore.setAttribute('data-anchor', 'history-restore');
      row.appendChild(restore);

      host.appendChild(row);
    });
  }

  function setChapter(id) {
    if (!id) return;
    state.chapterId = id;
    renderTree();
    renderHead();
    renderPaper();
    renderNotes();

    var paper = $('#paper');
    if (!paper) return;
    paper.classList.add('is-swapping');
    setTimeout(function () {
      paper.classList.remove('is-swapping');
    }, 120);
  }

  function pad2(n) {
    return n < 10 ? '0' + n : String(n);
  }

  function clock() {
    var now = new Date();
    return pad2(now.getHours()) + ':' + pad2(now.getMinutes()) + ':' + pad2(now.getSeconds());
  }

  function setSave(saveState) {
    var value = saveState || 'saved';
    state.save = value;
    var box = $('.app-topbar-save');
    if (box) box.setAttribute('data-save-state', value);

    var text = $('.app-topbar-save .save-text') || $('.save-text');
    if (!text) return;
    if (value === 'saving') {
      text.textContent = '保存中…';
    } else if (value === 'dirty') {
      text.textContent = '未保存';
    } else {
      text.textContent = '已保存 ' + clock();
    }
  }

  function showScene(name) {
    state.scene = name || 'writing';
    var app = $('#app');
    if (app) app.setAttribute('data-scene', state.scene);
  }

  function setMode(name) {
    state.mode = name || '';
    var app = $('#app');
    if (app) app.setAttribute('data-mode', state.mode);
  }

  function boot() {
    if (window.NS_CONTENT && window.NS_CONTENT !== C) {
      C = window.NS_CONTENT;
      window.NSAPP.C = C;
      if (!state.chapterId && C.currentId) state.chapterId = C.currentId;
      if (!currentChapter() && chapters().length) state.chapterId = chapters()[0].id;
    }

    renderTree();
    renderHead();
    renderPaper();
    renderNotes();
    renderAssets();
    renderHistory();

    document.documentElement.dataset.ready = '1';
  }

  window.NSAPP = {
    C: C,
    $: $,
    state: state,
    hanLen: hanLen,
    renderTree: renderTree,
    renderHead: renderHead,
    renderPaper: renderPaper,
    renderNotes: renderNotes,
    renderAssets: renderAssets,
    renderHistory: renderHistory,
    setChapter: setChapter,
    setSave: setSave,
    showScene: showScene,
    setMode: setMode,
    boot: boot
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      window.NSAPP.boot();
    });
  } else {
    window.NSAPP.boot();
  }
})();
