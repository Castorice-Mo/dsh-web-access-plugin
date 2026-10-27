window.__ModuleLoader__.load({
  id: 'dsh-web-access',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const NS = 'dsh-web-access'
    const ENDPOINT = '/api/dsh-web-access/state'

    const DICTIONARIES = {
      zh: {
        label: '联网搜索',
        on: '本会话「联网搜索」已开启：回答会检索并抓取网页，并附出处链接',
        off: '本会话「联网搜索」已关闭：点击开启后，回答会检索并抓取网页',
        unavailable: '未找到 Microsoft Edge：检索仍可用，网页渲染不可用',
        failed: '开关状态更新失败',
        pending: '正在读取开关状态…',
      },
      en: {
        // The visible label stays Chinese by request: the switch reads
        // 「联网搜索」 under the composer in every locale, while tooltips and
        // status text follow the active language.
        label: '联网搜索',
        on: 'Web search is on for this conversation: answers search, fetch and cite pages',
        off: 'Web search is off for this conversation: turn it on to search, fetch and cite pages',
        unavailable: 'Microsoft Edge not found: search still works, rendering does not',
        failed: 'Could not update the switch',
        pending: 'Reading the switch state…',
      },
    }

    function builtInTranslate(ctx) {
      let localeId = 'en'
      try {
        const snapshot = ctx.locale.getLocale()
        localeId = String(snapshot?.id ?? snapshot?.locale ?? 'en')
      } catch {
        localeId = 'en'
      }
      const dict = localeId.toLowerCase().startsWith('zh') ? DICTIONARIES.zh : DICTIONARIES.en
      return (key) => dict[key] ?? key
    }

    function makeTranslate(ctx) {
      const fallback = builtInTranslate(ctx)
      try {
        for (const localeId of Object.keys(DICTIONARIES)) {
          const dict = DICTIONARIES[localeId]
          ctx.effect(() => ctx.locale.register(NS, localeId, dict), `${NS}: locale ${localeId}`)
        }
        const bound = ctx.locale.bind(NS)
        return (key) => {
          try {
            return bound(key) ?? fallback(key)
          } catch {
            return fallback(key)
          }
        }
      } catch (error) {
        console.warn('[dsh-web-access] locale registration failed, using built-in text:', error)
        return fallback
      }
    }

    const COLORS = {
      border: 'var(--dsw-alias-border-l1)',
      borderActive: 'var(--dsw-alias-brand-primary)',
      surface: 'var(--dsw-alias-bg-layer-2)',
      label: 'var(--dsw-alias-label-primary)',
      labelMuted: 'var(--dsw-alias-label-secondary)',
      idle: 'var(--dsw-alias-state-idle-primary)',
      on: 'var(--dsw-alias-brand-primary)',
      warn: 'var(--dsw-alias-state-warn-primary)',
      error: 'var(--dsw-alias-state-error-primary)',
    }

    function Dot({ color, pulse }) {
      return h('span', {
        'aria-hidden': true,
        style: {
          width: 7,
          height: 7,
          borderRadius: '50%',
          background: color,
          boxShadow: pulse ? `0 0 0 3px color-mix(in srgb, ${color} 22%, transparent)` : 'none',
          transition: 'background 120ms ease',
          flex: '0 0 auto',
        },
      })
    }

    function WebAccessSwitch({ sessionId, t }) {
      const [state, setState] = React.useState({ phase: 'loading', enabled: false, edge: null })
      const [busy, setBusy] = React.useState(false)
      const [failure, setFailure] = React.useState('')

      React.useEffect(() => {
        if (!sessionId) {
          setState({ phase: 'ready', enabled: false, edge: null })
          return undefined
        }
        let alive = true
        setState((previous) => ({ ...previous, phase: 'loading' }))
        fetch(`${ENDPOINT}?session=${encodeURIComponent(sessionId)}`, {
          headers: { accept: 'application/json' },
          credentials: 'same-origin',
        })
          .then(async (response) => {
            if (!response.ok) throw new Error(`HTTP ${response.status}`)
            return response.json()
          })
          .then((payload) => {
            if (!alive) return
            setState({ phase: 'ready', enabled: payload?.enabled === true, edge: payload?.edge ?? null })
          })
          .catch((error) => {
            if (!alive) return
            setState({ phase: 'error', enabled: false, edge: null })
            setFailure(error.message)
          })
        return () => {
          alive = false
        }
      }, [sessionId])

      if (!sessionId) return null

      const busyNow = busy || state.phase === 'loading'
      const enabled = state.enabled === true
      const edgeMissing = state.edge && state.edge.available === false

      const toggle = async () => {
        if (busyNow) return
        const next = !enabled
        setBusy(true)
        setFailure('')
        try {
          const response = await fetch(ENDPOINT, {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ session: sessionId, enabled: next }),
          })
          if (!response.ok) {
            const detail = await response.json().catch(() => ({}))
            throw new Error(detail?.error ?? `HTTP ${response.status}`)
          }
          const payload = await response.json()
          setState((previous) => ({ ...previous, phase: 'ready', enabled: payload?.enabled === true }))
        } catch (error) {
          setFailure(error.message)
        } finally {
          setBusy(false)
        }
      }

      const tooltip = failure
        ? `${t('failed')}: ${failure}`
        : edgeMissing
          ? t('unavailable')
          : enabled
            ? t('on')
            : t('off')

      // Sits inside the composer tool row beside the permission control, so it
      // stays one compact chip: a state dot plus the label. The state is
      // carried by the dot colour, `aria-checked`, and the tooltip rather than
      // an ON/OFF word, whose width would jostle the row.
      return h(
        'button',
        {
          type: 'button',
          role: 'switch',
          'aria-checked': enabled,
          'aria-label': t('label'),
          title: tooltip,
          'data-dsh-web-access': 'switch',
          'data-enabled': enabled ? 'true' : 'false',
          disabled: busyNow,
          onClick: toggle,
          style: {
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
            height: 26,
            padding: '0 9px',
            borderRadius: 999,
            border: `1px solid ${failure ? COLORS.error : enabled ? COLORS.borderActive : COLORS.border}`,
            background: enabled ? COLORS.surface : 'transparent',
            color: enabled ? COLORS.label : COLORS.labelMuted,
            font: 'inherit',
            fontSize: 12,
            lineHeight: 1,
            whiteSpace: 'nowrap',
            cursor: busyNow ? 'progress' : 'pointer',
            opacity: busyNow ? 0.65 : 1,
            transition: 'border-color 120ms ease, color 120ms ease, background 120ms ease',
          },
        },
        h(Dot, {
          color: failure ? COLORS.error : enabled ? COLORS.on : COLORS.idle,
          pulse: enabled,
        }),
        h('span', null, t('label')),
        edgeMissing
          ? h(
              'span',
              {
                'aria-hidden': true,
                style: { color: COLORS.warn, fontSize: 11 },
              },
              '⚠',
            )
          : null,
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        const t = makeTranslate(ctx)
        // `conversation.composer.dock` renders below the composer card (the
        // statistics strip); the tool row inside the card is
        // `conversation.input.left`, which is where this switch belongs.
        ctx.slots.inject('conversation.input.left', () =>
          ctx.slots.register(
            {
              name: 'conversation.input.left',
              id: 'dsh-web-access',
              order: 10,
              label: () => t('label'),
              inject: (sessionId) => ({ sessionId }),
            },
            (props) => h(WebAccessSwitch, { sessionId: props?.sessionId, t }),
          ),
        )
      },
    }
  },
})
