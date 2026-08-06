(() => {
  'use strict';

  const state = {
    manifest: null,
    currentId: '',
    collapsed: {},
    query: ''
  };

  const els = {
    navTree: document.getElementById('navTree'),
    document: document.getElementById('document'),
    content: document.getElementById('content'),
    search: document.getElementById('searchInput'),
    menuButton: document.getElementById('menuButton'),
    overlay: document.getElementById('sidebarOverlay'),
    topbarMeta: document.getElementById('topbarMeta')
  };

  function escapeHtml(value = '') {
    return String(value).replace(/[&<>'"]/g, (char) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    })[char]);
  }

  function normalize(value = '') {
    return String(value).trim().toLowerCase();
  }

  function getAllItems() {
    if (!state.manifest) return [];

    return state.manifest.groups.flatMap(group =>
      group.items.map(item => ({
        ...item,
        groupKey: group.key,
        groupTitle: group.title
      }))
    );
  }

  function findItem(id) {
    return getAllItems().find(item => item.id === id) || null;
  }

  function loadCollapsedState() {
    try {
      state.collapsed =
        JSON.parse(localStorage.getItem('asr-collapsed') || '{}') || {};
    } catch (_) {
      state.collapsed = {};
    }
  }

  function saveCollapsedState() {
    try {
      localStorage.setItem(
        'asr-collapsed',
        JSON.stringify(state.collapsed)
      );
    } catch (_) {}
  }

  /**
   * 只展开指定的大类
   * 其他所有大类自动收起
   */
  function showOnlyGroup(activeKey) {
    const groups = state.manifest?.groups || [];

    groups.forEach(group => {
      state.collapsed[group.key] = group.key !== activeKey;
    });
  }

  function renderNav() {
    const query = normalize(state.query);
    const groups = state.manifest?.groups || [];

    let visibleCount = 0;

    els.navTree.innerHTML = groups.map(group => {
      const items = group.items.filter(item => {
        if (!query) return true;

        const haystack = [
          item.title,
          item.id,
          item.keywords?.join(' ')
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();

        return haystack.includes(query);
      });

      if (!items.length && query) {
        return '';
      }

      visibleCount += items.length;

      /*
       * 搜索状态：
       * 临时展开所有有匹配结果的大类
       *
       * 正常状态：
       * 根据 collapsed 控制展开/收起
       */
      const isCollapsed = query
        ? false
        : Boolean(state.collapsed[group.key]);

      const itemHtml = items.map(item => `
        <button
          class="nav-item${item.id === state.currentId ? ' active' : ''}"
          type="button"
          data-doc-id="${escapeHtml(item.id)}"
          title="${escapeHtml(item.title)}"
        >
          <span class="nav-icon" aria-hidden="true">
            ${escapeHtml(item.icon || '•')}
          </span>

          <span class="nav-label">
            ${escapeHtml(item.title)}
          </span>
        </button>
      `).join('');

      return `
        <section
          class="nav-group${isCollapsed ? ' collapsed' : ''}"
          data-group="${escapeHtml(group.key)}"
        >
          <button
            class="nav-group-title"
            type="button"
            data-group-toggle="${escapeHtml(group.key)}"
            aria-expanded="${!isCollapsed}"
          >
            <span class="chevron" aria-hidden="true">▼</span>
            <span>${escapeHtml(group.title)}</span>
          </button>

          <div class="nav-items">
            ${itemHtml}
          </div>
        </section>
      `;
    }).join('');

    if (!visibleCount && query) {
      els.navTree.innerHTML = `
        <div class="nav-empty">
          没有找到“${escapeHtml(state.query)}”相关内容。
        </div>
      `;
    }
  }

  function enhanceMarkdown(root) {
    root.querySelectorAll('table').forEach(table => {
      if (
        table.parentElement?.classList.contains('table-wrap')
      ) {
        return;
      }

      const wrap = document.createElement('div');
      wrap.className = 'table-wrap';

      table.parentNode.insertBefore(wrap, table);
      wrap.appendChild(table);
    });
  }

  function extractTitle(markdown, fallbackTitle) {
    const lines = markdown
      .replace(/^\uFEFF/, '')
      .split(/\r?\n/);

    const index = lines.findIndex(line =>
      /^#\s+/.test(line)
    );

    if (index === -1) {
      return {
        title: fallbackTitle,
        body: markdown
      };
    }

    const title =
      lines[index]
        .replace(/^#\s+/, '')
        .trim() || fallbackTitle;

    lines.splice(index, 1);

    return {
      title,
      body: lines
        .join('\n')
        .replace(/^\s+/, '')
    };
  }

  async function loadDocument(id, pushHash = false) {
    const item =
      findItem(id) ||
      getAllItems()[0];

    if (!item) return;

    /*
     * 当前文章所属的大类自动展开，
     * 其他所有大类自动收起
     */
    state.currentId = item.id;

    showOnlyGroup(item.groupKey);

    saveCollapsedState();

    renderNav();

    els.document.innerHTML = `
      <div class="loading-state">
        <span class="loading-dot"></span>
        <span>正在读取 Markdown…</span>
      </div>
    `;

    try {
      const response = await fetch(
        encodeURI(item.file),
        {
          cache: 'no-store'
        }
      );

      if (!response.ok) {
        throw new Error(
          `HTTP ${response.status}`
        );
      }

      const markdown =
        await response.text();

      const {
        title,
        body
      } = extractTitle(
        markdown,
        item.title
      );

      const updated =
        item.updated ||
        state.manifest.updated ||
        '';

      const parser =
        window.marked?.parse
          ? window.marked.parse
          : window.marked;

      if (typeof parser !== 'function') {
        throw new Error(
          'Markdown 解析器未加载'
        );
      }

      els.document.innerHTML = `
        <header class="doc-header">

          <h1>
            ${escapeHtml(title)}
          </h1>

          <div class="doc-meta">

            <span>
              ${escapeHtml(item.groupTitle)}
            </span>

            ${
              updated
                ? `
                  <span class="dot">·</span>

                  <span>
                    最后更新 ${escapeHtml(updated)}
                  </span>
                `
                : ''
            }

          </div>

        </header>

        <div class="markdown-body">
          ${parser(body)}
        </div>
      `;

      enhanceMarkdown(
        els.document
      );

      els.content.scrollTop = 0;

      document.title =
        `${title} - A股投资研究知识库`;

      if (
        pushHash &&
        location.hash !== `#${item.id}`
      ) {
        history.pushState(
          null,
          '',
          `#${item.id}`
        );
      }

    } catch (error) {
      console.error(error);

      const fileMode =
        location.protocol === 'file:';

      els.document.innerHTML = `
        <div class="error-panel">

          <h2>
            页面内容没有成功载入
          </h2>

          ${
            fileMode
              ? `
                <p>
                  这套页面是真正从
                  <code>data/index.json</code>
                  和 Markdown 文件读取内容，
                  浏览器直接双击
                  <code>index.html</code>
                  时会阻止本地文件请求。
                </p>

                <p>
                  请双击根目录的
                  <code>run-preview.bat</code>，
                  或通过 GitHub Pages /
                  本地 Web 服务器预览。
                </p>
              `
              : `
                <p>
                  未能读取
                  <code>${escapeHtml(item.file)}</code>。
                  请检查文件路径和服务器配置。
                </p>
              `
          }

        </div>
      `;
    }
  }

  function openSidebar() {
    document.body.classList.add(
      'sidebar-open'
    );

    els.menuButton.setAttribute(
      'aria-expanded',
      'true'
    );
  }

  function closeSidebar() {
    document.body.classList.remove(
      'sidebar-open'
    );

    els.menuButton.setAttribute(
      'aria-expanded',
      'false'
    );
  }

  function bindEvents() {

    /*
     * 左侧导航点击事件
     */
    els.navTree.addEventListener(
      'click',
      event => {

        /*
         * 点击大类标题
         */
        const toggle =
          event.target.closest(
            '[data-group-toggle]'
          );

        if (toggle) {

          const key =
            toggle.dataset.groupToggle;

          /*
           * 手风琴模式：
           * 当前点击的大类展开，
           * 其他大类全部收起
           */
          showOnlyGroup(key);

          saveCollapsedState();

          renderNav();

          return;
        }

        /*
         * 点击具体文章
         */
        const item =
          event.target.closest(
            '[data-doc-id]'
          );

        if (item) {

          loadDocument(
            item.dataset.docId,
            true
          );

          /*
           * 手机端打开文章后
           * 自动关闭侧边栏
           */
          if (
            window
              .matchMedia(
                '(max-width: 860px)'
              )
              .matches
          ) {
            closeSidebar();
          }
        }
      }
    );

    /*
     * 搜索
     */
    els.search.addEventListener(
      'input',
      () => {
        state.query =
          els.search.value;

        renderNav();
      }
    );

    /*
     * 手机端菜单
     */
    els.menuButton.addEventListener(
      'click',
      () => {

        document.body.classList.contains(
          'sidebar-open'
        )
          ? closeSidebar()
          : openSidebar();
      }
    );

    /*
     * 遮罩
     */
    els.overlay.addEventListener(
      'click',
      closeSidebar
    );

    /*
     * 浏览器前进 / 后退
     */
    window.addEventListener(
      'hashchange',
      () => {

        const id =
          location.hash.replace(
            /^#/,
            ''
          );

        if (
          id &&
          id !== state.currentId &&
          findItem(id)
        ) {
          loadDocument(
            id,
            false
          );
        }
      }
    );

    /*
     * 桌面端恢复时关闭移动端侧栏
     */
    window.addEventListener(
      'resize',
      () => {

        if (
          window.innerWidth > 860
        ) {
          closeSidebar();
        }
      }
    );

    /*
     * 快捷键
     */
    document.addEventListener(
      'keydown',
      event => {

        /*
         * ESC 关闭侧栏
         */
        if (
          event.key === 'Escape'
        ) {
          closeSidebar();
        }

        /*
         * Ctrl + K
         * 聚焦搜索框
         */
        if (
          (
            event.ctrlKey ||
            event.metaKey
          ) &&
          event.key.toLowerCase() === 'k'
        ) {

          event.preventDefault();

          els.search.focus();

          if (
            window
              .matchMedia(
                '(max-width: 860px)'
              )
              .matches
          ) {
            openSidebar();
          }
        }
      }
    );
  }

  async function init() {

    /*
     * 读取之前保存的菜单状态
     */
    loadCollapsedState();

    /*
     * 绑定事件
     */
    bindEvents();

    try {

      /*
       * 读取知识库索引
       */
      const response =
        await fetch(
          'data/index.json',
          {
            cache: 'no-store'
          }
        );

      if (!response.ok) {
        throw new Error(
          `HTTP ${response.status}`
        );
      }

      state.manifest =
        await response.json();

      /*
       * 顶部版本信息
       */
      els.topbarMeta.textContent =
        `个人长期积累 · Markdown 驱动 · v${
          state.manifest.version ||
          '1.0.0'
        }`;

      /*
       * 判断 URL 中是否指定文章
       */
      const requested =
        location.hash.replace(
          /^#/,
          ''
        );

      /*
       * 优先级：
       *
       * 1. URL #文章ID
       * 2. index.json 中 default
       * 3. 第一篇文章
       */
      const initialId =
        findItem(requested)
          ? requested
          : (
              state.manifest.default ||
              getAllItems()[0]?.id
            );

      /*
       * loadDocument 内部会自动：
       *
       * 1. 找到文章所属大类
       * 2. 展开这个大类
       * 3. 收起其他所有大类
       *
       * 因此默认打开第一篇文章时，
       * 左侧也只会展开第一个大类。
       */
      await loadDocument(
        initialId,
        Boolean(
          !requested &&
          initialId
        )
      );

    } catch (error) {

      console.error(error);

      const fileMode =
        location.protocol === 'file:';

      els.document.innerHTML = `
        <div class="error-panel">

          <h2>
            知识库索引没有成功载入
          </h2>

          ${
            fileMode
              ? `
                <p>
                  当前是直接双击 HTML 的
                  <code>file://</code>
                  模式。
                  为了保持“Markdown 真正驱动”，
                  页面需要通过本地 Web 服务读取文件。
                </p>

                <p>
                  请双击根目录
                  <code>run-preview.bat</code>，
                  浏览器会自动打开预览页面。
                </p>
              `
              : `
                <p>
                  请检查
                  <code>data/index.json</code>
                  是否存在、
                  JSON 格式是否正确。
                </p>
              `
          }

        </div>
      `;
    }
  }

  init();

})();