window.__ModuleLoader__.load({
	id: 'dsh-files-menu',
	factory(require) {
		/**
		 * A right-click menu for the workspace file tree in the right sidebar.
		 *
		 * The Host renders that tree (`@deepseek-ai/dsh-client-ui-sidebar-files`)
		 * without a context menu and exposes no slot per row, so this plugin
		 * listens for `contextmenu` on the rendered rows and draws its own menu.
		 * Rows carry `data-files-entry` (`file` / `directory` / `other`) and the
		 * absolute path in `data-files-path`; the tree root carries
		 * `data-files-root`. Only `--dsw-*` theme tokens are used for styling.
		 *
		 * Everything is created inside `apply` through `ctx.effect`, so
		 * unloading the plugin removes its listeners, styles, menu and toast.
		 */
		/** Locale namespace owned by this plugin. */
		const NS = 'filesMenu';
		/** Marks the row the open menu belongs to, for the highlight. */
		const ACTIVE_ATTRIBUTE = 'data-dfm-active';
		/** Marks the menu element; also the test hook. */
		const MENU_ATTRIBUTE = 'data-dfm-menu';

		/** The open menu surface, or null. */
		let menuElement = null;
		/** The row the open menu acts on, or null. */
		let menuTarget = null;
		/** The visible toast, or null. */
		let toastElement = null;
		/** Pending toast dismissal. */
		let toastTimer = 0;
		/** Whether the Host reported a desktop file manager. */
		let desktopAvailable = false;

		/** Simplified Chinese dictionary (key-set source of truth). */
		const zh = {
			'menu.label': '文件操作',
			'action.open': '打开',
			'action.expand': '展开文件夹',
			'action.collapse': '折叠文件夹',
			'action.copyFilePath': '复制文件地址',
			'action.copyFolderPath': '复制文件夹地址',
			'action.copyRelativePath': '复制相对路径',
			'action.copyFileName': '复制文件名',
			'action.copyFolderName': '复制文件夹名',
			'action.reveal': '在资源管理器中显示',
			'action.openInManager': '在资源管理器中打开',
			'toast.copied': '已复制',
			'toast.copyFailed': '复制失败',
			'toast.revealFailed': '无法在资源管理器中显示'
		};

		/** English dictionary, key-identical to the Chinese source of truth. */
		const en = {
			'menu.label': 'File actions',
			'action.open': 'Open',
			'action.expand': 'Expand folder',
			'action.collapse': 'Collapse folder',
			'action.copyFilePath': 'Copy file path',
			'action.copyFolderPath': 'Copy folder path',
			'action.copyRelativePath': 'Copy relative path',
			'action.copyFileName': 'Copy file name',
			'action.copyFolderName': 'Copy folder name',
			'action.reveal': 'Show in Explorer',
			'action.openInManager': 'Open in Explorer',
			'toast.copied': 'Copied',
			'toast.copyFailed': 'Copy failed',
			'toast.revealFailed': 'Could not show it in the file manager'
		};

		/** 14px line icons; geometric artwork drawn for this plugin. */
		const ICONS = {
			copy: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2"><rect x="5.25" y="5.25" width="8" height="8" rx="1.6"/><path d="M10.75 3.75V3.1a1.6 1.6 0 0 0-1.6-1.6H3.35a1.6 1.6 0 0 0-1.6 1.6v5.8a1.6 1.6 0 0 0 1.6 1.6h.65"/></svg>',
			link: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M6.6 9.4a2.9 2.9 0 0 0 4.1 0l2-2a2.9 2.9 0 0 0-4.1-4.1l-.9.9"/><path d="M9.4 6.6a2.9 2.9 0 0 0-4.1 0l-2 2a2.9 2.9 0 1 0 4.1 4.1l.9-.9"/></svg>',
			text: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M3.4 3.4h9.2M8 3.4v9.2"/><path d="M5.8 12.6h4.4"/></svg>',
			open: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M4 2.6h5l3 3v7.8H4z"/><path d="M9 2.6v3.2h3"/></svg>',
			external: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M9.4 3.2h3.4v3.4"/><path d="M12.8 3.2 7.6 8.4"/><path d="M11.4 9.8v3H3.2V4.6h3"/></svg>',
			folderOpen: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M2.6 12.2V3.8h3.6l1.3 1.7h3.6v1.5"/><path d="M2.6 12.2 4.4 7h9l-1.8 5.2z"/></svg>',
			chevronDown: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><path d="m4.4 6.2 3.6 3.6 3.6-3.6"/></svg>',
			chevronUp: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><path d="m4.4 9.8 3.6-3.6 3.6 3.6"/></svg>'
		};

		/**
		 * Menu, toast and row-highlight styles: the Host menu's own spacing and
		 * colors, renamed under this plugin's prefix and limited to theme tokens.
		 */
		const STYLES = [
			'.dfm-menu{position:fixed;z-index:1100;box-sizing:border-box;min-width:176px;max-width:360px;padding:4px;display:flex;flex-direction:column;border:0;border-radius:var(--dsw-radius-lg,10px);isolation:isolate;color:var(--dsw-alias-label-primary,#1f2329);font:inherit;font-size:13px;line-height:20px;box-shadow:var(--dsw-elevation-prominent,0 10px 30px rgba(0,0,0,.18))}',
			'.dfm-material{position:absolute;inset:0;z-index:-1;border-radius:inherit;border:.5px solid var(--dsw-alias-border-l1,rgba(0,0,0,.08));background:var(--dsw-menu-surface-fill,rgba(250,250,252,.94));backdrop-filter:var(--dsw-menu-backdrop-filter,blur(20px) saturate(1.4));pointer-events:none}',
			'.dfm-item{display:flex;align-items:center;gap:8px;width:100%;min-height:32px;padding:4px 8px;border:none;border-radius:var(--dsw-radius-md,8px);background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}',
			'.dfm-item:hover:not(:disabled),.dfm-item:focus-visible:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.06));outline:none}',
			'.dfm-item:disabled{opacity:.4;cursor:default}',
			'.dfm-icon{display:inline-flex;flex:none;width:14px;height:14px;align-items:center;justify-content:center;color:var(--dsw-alias-menu-icon,#6b7280)}',
			'.dfm-icon svg{width:14px;height:14px;display:block}',
			'.dfm-label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
			'.dfm-sep{height:.5px;margin:3px 2px;background:var(--dsw-alias-border-l2,rgba(0,0,0,.08))}',
			'.dfm-toast{position:fixed;left:50%;bottom:48px;transform:translateX(-50%);z-index:1200;box-sizing:border-box;max-width:70vw;padding:7px 12px;border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-bg-layer-3,#26262b);color:var(--dsw-alias-label-primary,#fff);font-size:12px;line-height:18px;box-shadow:var(--dsw-elevation-prominent,0 8px 24px rgba(0,0,0,.22));pointer-events:none;opacity:0;transition:opacity .12s ease}',
			'.dfm-toast[data-dfm-show]{opacity:1}',
			`li[${ACTIVE_ATTRIBUTE}] > button{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.06))}`
		].join('\n');

		/**
		 * Write text to the clipboard: the async API where it is allowed, and a
		 * hidden textarea plus `execCommand` for the rest (HTTP origins).
		 * @param text - the string to copy.
		 * @returns whether the copy reported success.
		 */
		async function writeClipboard(text) {
			if (navigator.clipboard !== undefined && typeof navigator.clipboard.writeText === 'function') {
				try {
					await navigator.clipboard.writeText(text);
					return true;
				} catch { /* fall through to execCommand */ }
			}
			try {
				const area = document.createElement('textarea');
				area.value = text;
				area.setAttribute('readonly', '');
				area.style.position = 'fixed';
				area.style.top = '-1000px';
				area.style.opacity = '0';
				document.body.appendChild(area);
				area.select();
				area.setSelectionRange(0, text.length);
				const copied = typeof document.execCommand === 'function' ? document.execCommand('copy') : false;
				area.remove();
				return copied;
			} catch {
				return false;
			}
		}

		/**
		 * The last path segment of either separator spelling.
		 * @param path - an absolute path.
		 * @returns the basename.
		 */
		function basename(path) {
			const parts = path.split(/[\\/]/).filter((part) => part.length > 0);
			return parts.length === 0 ? path : parts[parts.length - 1];
		}

		/**
		 * A path relative to the tree's root, when the path lives under it.
		 * @param root - the tree root, absolute.
		 * @param path - the entry's absolute path.
		 * @returns the relative path, or the original path when it is not under the root.
		 */
		function relativePath(root, path) {
			if (typeof root !== 'string' || root.length === 0) return path;
			const normalizedPath = path.replace(/\\/g, '/');
			const normalizedRoot = root.replace(/\\/g, '/').replace(/\/+$/, '');
			if (normalizedRoot.length === 0) return normalizedPath;
			const prefix = `${normalizedRoot}/`;
			if (normalizedPath.startsWith(prefix)) return normalizedPath.slice(prefix.length);
			const windows = /^[A-Za-z]:/.test(normalizedRoot) || normalizedRoot.startsWith('//');
			if (windows && normalizedPath.toLowerCase().startsWith(prefix.toLowerCase())) {
				return normalizedPath.slice(prefix.length);
			}
			return normalizedPath;
		}

		/**
		 * The file-tree row an event target belongs to.
		 * @param node - the event target.
		 * @returns the row's facts, or null outside the tree body.
		 */
		function rowOf(node) {
			const element = node instanceof Element ? node : node instanceof Node ? node.parentElement : null;
			if (element === null) return null;
			const entry = element.closest('li[data-files-entry]');
			if (entry === null || entry.closest('[data-files-body]') === null) return null;
			const kind = entry.getAttribute('data-files-entry');
			const path = entry.getAttribute('data-files-path');
			if (kind === null || path === null || kind === 'other') return null;
			const tree = entry.closest('[data-files-root]');
			return {
				entry,
				kind,
				path,
				root: tree === null ? null : tree.getAttribute('data-files-root')
			};
		}

		/** Create one menu item button. */
		function menuItem(item) {
			const button = document.createElement('button');
			button.type = 'button';
			button.className = 'dfm-item';
			button.setAttribute('role', 'menuitem');
			button.dataset.dfmAction = item.id;
			if (item.icon !== undefined) {
				const icon = document.createElement('span');
				icon.className = 'dfm-icon';
				icon.setAttribute('aria-hidden', 'true');
				icon.innerHTML = ICONS[item.icon];
				button.appendChild(icon);
			}
			const label = document.createElement('span');
			label.className = 'dfm-label';
			label.textContent = item.label;
			button.appendChild(label);
			return button;
		}

		/** The separator line between groups. */
		function menuSeparator() {
			const separator = document.createElement('div');
			separator.className = 'dfm-sep';
			separator.setAttribute('role', 'separator');
			return separator;
		}

		/**
		 * The actions for one row, in menu order.
		 * @param target - the row's facts.
		 * @param t - namespace-bound translate.
		 * @returns the item descriptors.
		 */
		function menuItems(target, t) {
			const directory = target.kind === 'directory';
			const button = target.entry.querySelector('button');
			const expanded = directory && button !== null && button.getAttribute('aria-expanded') === 'true';
			const items = directory
				? [{ id: 'toggle', label: t(expanded ? 'action.collapse' : 'action.expand'), icon: expanded ? 'chevronUp' : 'chevronDown' }]
				: [{ id: 'open', label: t('action.open'), icon: 'open' }];
			items.push({ separator: true }, {
				id: 'copy-path',
				label: t(directory ? 'action.copyFolderPath' : 'action.copyFilePath'),
				icon: 'copy'
			}, {
				id: 'copy-relative',
				label: t('action.copyRelativePath'),
				icon: 'link'
			}, {
				id: 'copy-name',
				label: t(directory ? 'action.copyFolderName' : 'action.copyFileName'),
				icon: 'text'
			});
			if (desktopAvailable) {
				items.push({ separator: true }, directory
					? { id: 'open-directory', label: t('action.openInManager'), icon: 'folderOpen' }
					: { id: 'reveal', label: t('action.reveal'), icon: 'external' });
			}
			return items;
		}

		/** Show a transient confirmation above the composer area. */
		function showToast(text) {
			if (toastElement !== null) {
				toastElement.remove();
				toastElement = null;
			}
			window.clearTimeout(toastTimer);
			const toast = document.createElement('div');
			toast.className = 'dfm-toast';
			toast.setAttribute('role', 'status');
			toast.setAttribute('aria-live', 'polite');
			toast.textContent = text;
			document.body.appendChild(toast);
			toastElement = toast;
			requestAnimationFrame(() => {
				if (toastElement === toast) toast.setAttribute('data-dfm-show', '');
			});
			toastTimer = window.setTimeout(() => {
				if (toastElement !== toast) return;
				toast.remove();
				toastElement = null;
			}, 1400);
		}

		/** Copy text and report the outcome. */
		async function copyText(text, t) {
			const copied = await writeClipboard(text);
			showToast(copied ? t('toast.copied') : t('toast.copyFailed'));
		}

		/**
		 * Ask the Host to hand a path to the desktop.
		 * @param ctx - the client context.
		 * @param t - namespace-bound translate.
		 * @param path - absolute path to open or reveal.
		 * @param action - `reveal` to select it in its folder; omit to open it.
		 */
		async function openOnDesktop(ctx, t, path, action) {
			try {
				const request = action === undefined ? { path } : { path, action };
				const result = await ctx.remote.session.openWorkspacePath(request);
				if (result === undefined || result.ok !== true) showToast(t('toast.revealFailed'));
			} catch {
				showToast(t('toast.revealFailed'));
			}
		}

		/** Close the open menu, optionally returning focus to its row. */
		function closeMenu(restoreFocus) {
			if (menuElement === null) return;
			const target = menuTarget;
			menuElement.remove();
			menuElement = null;
			menuTarget = null;
			if (target !== null) {
				target.entry.removeAttribute(ACTIVE_ATTRIBUTE);
				if (restoreFocus === true) {
					const button = target.entry.querySelector('button');
					if (button !== null) button.focus({ preventScroll: true });
				}
			}
		}

		/** Move focus among the enabled items. */
		function moveFocus(key) {
			if (menuElement === null) return;
			const items = [...menuElement.querySelectorAll('.dfm-item:not(:disabled)')];
			if (items.length === 0) return;
			const current = items.indexOf(document.activeElement);
			let next;
			if (key === 'Home') next = 0;
			else if (key === 'End') next = items.length - 1;
			else if (key === 'ArrowDown') next = current < 0 ? 0 : (current + 1) % items.length;
			else next = current < 0 ? items.length - 1 : (current - 1 + items.length) % items.length;
			items[next].focus({ preventScroll: true });
		}

		/**
		 * Place the menu at a viewport point, kept inside the window.
		 * @param menu - the menu surface.
		 * @param point - viewport coordinates, normally the pointer.
		 */
		function placeMenu(menu, point) {
			const margin = 8;
			const box = menu.getBoundingClientRect();
			const width = window.innerWidth;
			const height = window.innerHeight;
			let left = point.x;
			let top = point.y;
			if (left + box.width > width - margin) left = Math.max(margin, width - box.width - margin);
			if (top + box.height > height - margin) top = Math.max(margin, height - box.height - margin);
			menu.style.left = `${Math.round(left)}px`;
			menu.style.top = `${Math.round(top)}px`;
		}

		/**
		 * Open the menu for one row.
		 * @param ctx - the client context.
		 * @param target - the row's facts.
		 * @param point - viewport coordinates to open at.
		 * @param t - namespace-bound translate.
		 * @param focusFirst - whether to move focus into the menu (keyboard opening);
		 *   a pointer-opened menu leaves focus where it was, as host menus do.
		 */
		function openMenu(ctx, target, point, t, focusFirst) {
			closeMenu(false);
			const menu = document.createElement('div');
			menu.className = 'dfm-menu';
			menu.setAttribute(MENU_ATTRIBUTE, '');
			menu.setAttribute('role', 'menu');
			menu.setAttribute('aria-label', t('menu.label'));
			const material = document.createElement('div');
			material.className = 'dfm-material';
			material.setAttribute('aria-hidden', 'true');
			menu.appendChild(material);
			for (const item of menuItems(target, t)) {
				menu.appendChild(item.separator === true ? menuSeparator() : menuItem(item));
			}
			menu.addEventListener('click', (event) => {
				const button = event.target instanceof Element ? event.target.closest('button[data-dfm-action]') : null;
				if (button === null) {
					menu.remove();
					return;
				}
				event.preventDefault();
				event.stopPropagation();
				const action = button.dataset.dfmAction;
				const selected = menuTarget;
				closeMenu(true);
				runAction(ctx, selected, action, t);
			});
			document.body.appendChild(menu);
			menuElement = menu;
			menuTarget = target;
			target.entry.setAttribute(ACTIVE_ATTRIBUTE, '');
			placeMenu(menu, point);
			if (focusFirst === true) {
				const first = menu.querySelector('.dfm-item:not(:disabled)');
				if (first !== null) first.focus({ preventScroll: true });
			}
		}

		/**
		 * Perform one menu action for the row the menu was opened on.
		 * @param ctx - the client context.
		 * @param target - the row's facts.
		 * @param action - the selected item id.
		 * @param t - namespace-bound translate.
		 */
		async function runAction(ctx, target, action, t) {
			if (target === null) return;
			switch (action) {
				case 'open':
				case 'toggle': {
					const button = target.entry.querySelector('button');
					if (button !== null) button.click();
					return;
				}
				case 'copy-path':
					await copyText(target.path, t);
					return;
				case 'copy-relative':
					await copyText(relativePath(target.root, target.path), t);
					return;
				case 'copy-name':
					await copyText(basename(target.path), t);
					return;
				case 'reveal':
					await openOnDesktop(ctx, t, target.path, 'reveal');
					return;
				case 'open-directory':
					await openOnDesktop(ctx, t, target.path, undefined);
					return;
				default:
					return;
			}
		}

		/**
		 * Client plugin body: dictionaries, one style tag, and the delegated
		 * listeners behind the row menu.
		 * @param ctx - client root context.
		 */
		function apply(ctx) {
			const t = ctx.locale.bind(NS);
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'files-menu: dictionaries');

			const probe = () => {
				try {
					Promise.resolve(ctx.remote.session.canOpenWorkspacePath()).then((result) => {
						desktopAvailable = result !== undefined && result.ok === true && result.value === true;
					}, () => {});
				} catch { /* no desktop surface: keep the reveal actions hidden */ }
			};
			probe();

			ctx.effect(() => {
				const style = document.createElement('style');
				style.dataset.dfmStyle = '';
				style.textContent = STYLES;
				document.head.appendChild(style);

				const onContextMenu = (event) => {
					const target = rowOf(event.target);
					if (target === null) return;
					event.preventDefault();
					event.stopPropagation();
					openMenu(ctx, target, { x: event.clientX, y: event.clientY }, t, false);
				};

				const onKeyDown = (event) => {
					if (menuElement !== null) {
						if (event.key === 'Escape') {
							event.preventDefault();
							event.stopPropagation();
							closeMenu(true);
							return;
						}
						if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
							event.preventDefault();
							event.stopPropagation();
							moveFocus(event.key);
							return;
						}
						if (event.key === 'Tab') {
							closeMenu(true);
							return;
						}
					}
					if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
						const target = rowOf(event.target);
						if (target === null) return;
						event.preventDefault();
						event.stopPropagation();
						const box = target.entry.getBoundingClientRect();
						openMenu(ctx, target, { x: box.left + 8, y: box.bottom - 2 }, t, true);
					}
				};

				const onPointerDown = (event) => {
					if (menuElement === null) return;
					if (event.target instanceof Node && menuElement.contains(event.target)) return;
					closeMenu(false);
				};

				const onDismiss = () => {
					closeMenu(false);
				};

				document.addEventListener('contextmenu', onContextMenu, true);
				document.addEventListener('keydown', onKeyDown, true);
				document.addEventListener('pointerdown', onPointerDown, true);
				document.addEventListener('scroll', onDismiss, true);
				window.addEventListener('resize', onDismiss);
				window.addEventListener('blur', onDismiss);

				return () => {
					document.removeEventListener('contextmenu', onContextMenu, true);
					document.removeEventListener('keydown', onKeyDown, true);
					document.removeEventListener('pointerdown', onPointerDown, true);
					document.removeEventListener('scroll', onDismiss, true);
					window.removeEventListener('resize', onDismiss);
					window.removeEventListener('blur', onDismiss);
					closeMenu(false);
					window.clearTimeout(toastTimer);
					if (toastElement !== null) {
						toastElement.remove();
						toastElement = null;
					}
					style.remove();
				};
			}, 'files-menu: context menu');
		}

		return { inject: ['locale', 'remote', 'remote.session'], apply };
	}
});