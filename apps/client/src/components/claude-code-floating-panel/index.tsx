import '@xterm/xterm/css/xterm.css';

import {
  closeClaudeCodeHistoryPanel,
  closeClaudeCodePanel,
  openClaudeCodePanel,
} from '@/features/app/actions';
import {
  useClaudeCodeHistoryOpen,
  useClaudeCodePanelOpen,
  useSelectedDmChannelId
} from '@/features/app/hooks';
import { useDmsOpen } from '@/features/server/hooks';
import { getHostFromServer } from '@/helpers/get-file-url';
import { getSessionStorageItem, SessionStorageKey } from '@/helpers/storage';
import { getTRPCClient } from '@/lib/trpc';
import { cn } from '@/lib/utils';
import type { TClaudeCodeStatus } from '@mikotord/shared';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import { Trash2 } from 'lucide-react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';

type TPtyMessage =
  | { type: 'output'; data: string }
  | { type: 'status'; status: TClaudeCodeStatus };

type TClaudeCodeHistoryItem = {
  id: string;
  claudeSessionId: string;
  createdAt: number;
  updatedAt: number;
  current: boolean;
  available: boolean;
};

const getWsUrl = () => {
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const host = getHostFromServer();
  const token = getSessionStorageItem(SessionStorageKey.TOKEN) ?? '';

  return `${protocol}://${host}/claude-code/pty?token=${encodeURIComponent(token)}`;
};

const MASCOT_SIZE = 78;
const DEFAULT_MASCOT_RECT = {
  left: 24,
  bottom: 16
};

const ClaudeCodeFloatingPanel = memo(() => {
  const open = useClaudeCodePanelOpen();
  const historyOpen = useClaudeCodeHistoryOpen();
  const selectedDmChannelId = useSelectedDmChannelId();
  const dmsOpen = useDmsOpen();
  const [claudeCodeDmChannelId, setClaudeCodeDmChannelId] = useState<
    number | undefined
  >();
  const [dmResolved, setDmResolved] = useState(false);
  const [status, setStatus] = useState<TClaudeCodeStatus>({
    state: 'idle',
    connected: false,
    updatedAt: Date.now()
  });
  const [historyItems, setHistoryItems] = useState<TClaudeCodeHistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [panelHost, setPanelHost] = useState<HTMLElement | null>(null);
  const [mascotRect, setMascotRect] = useState(DEFAULT_MASCOT_RECT);
  const terminalContainerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const outputBufferRef = useRef('');
  const previousStatusStateRef = useRef<TClaudeCodeStatus['state']>('idle');
  const happyTimeoutRef = useRef<number | undefined>(undefined);
  const [showHappyMascot, setShowHappyMascot] = useState(false);
  const isClaudeCodeConversation =
    dmsOpen &&
    selectedDmChannelId !== undefined &&
    selectedDmChannelId === claudeCodeDmChannelId;
  const resolvePanelHost = useCallback(
    () => {
      if (historyOpen) {
        return document.querySelector<HTMLElement>(
          '[data-claude-code-history-panel-host="true"]'
        );
      }

      return document.querySelector<HTMLElement>(
        [
          '[data-claude-code-active-panel-host="true"]',
          '[data-claude-code-virtual-panel-host="true"]'
        ].join(',')
      );
    },
    [historyOpen]
  );
  const scrollToPanelHost = useCallback(() => {
    const host = resolvePanelHost();

    if (!host) return;

    setPanelHost(host);
    host.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest'
    });
  }, [resolvePanelHost]);

  const sendResize = useCallback(() => {
    const terminal = terminalRef.current;
    const fitAddon = fitAddonRef.current;
    const ws = wsRef.current;

    if (!terminal || !fitAddon) return;

    fitAddon.fit();

    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(
        JSON.stringify({
          type: 'resize',
          cols: terminal.cols,
          rows: terminal.rows
        })
      );
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    getTRPCClient()
      .agents.getClaudeCodeDm.query()
      .then((result) => {
        if (cancelled) return;

        setClaudeCodeDmChannelId(result.channelId);
      })
      .catch(() => undefined)
      .finally(() => {
        if (cancelled) return;

        setDmResolved(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isClaudeCodeConversation || !open || !panelHost) return;

    const container = terminalContainerRef.current;

    if (!container || terminalRef.current) return;

    const terminal = new Terminal({
      cursorBlink: true,
      convertEol: true,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      fontSize: 12,
      theme: {
        background: '#050505',
        foreground: '#e7e7e7',
        cursor: '#22c55e',
        selectionBackground: '#334155'
      }
    });
    const fitAddon = new FitAddon();

    terminal.loadAddon(fitAddon);
    terminal.open(container);
    terminal.writeln('ClaudeCode PTY ready.');
    terminal.focus();

    if (outputBufferRef.current) {
      terminal.write(outputBufferRef.current);
    }

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    const disposable = terminal.onData((data) => {
      if (data === '\x03') {
        toast.info('已屏蔽 Ctrl+C，避免退出 ClaudeCode');
        return;
      }

      const ws = wsRef.current;

      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input', data }));
      }
    });
    const binaryDisposable = terminal.onBinary((data) => {
      const ws = wsRef.current;

      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input', data }));
      }
    });
    const resizeObserver = new ResizeObserver(() => sendResize());

    resizeObserver.observe(container);
    window.setTimeout(sendResize, 0);

    return () => {
      disposable.dispose();
      binaryDisposable.dispose();
      resizeObserver.disconnect();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, [isClaudeCodeConversation, open, panelHost, sendResize]);

  useEffect(() => {
    if (!open) return;

    terminalRef.current?.focus();
  }, [open]);

  useEffect(() => {
    const previousState = previousStatusStateRef.current;

    if (
      (previousState === 'running' || previousState === 'waiting_for_user') &&
      status.state === 'idle'
    ) {
      closeClaudeCodeHistoryPanel();
      closeClaudeCodePanel();
      setPanelHost(null);
      setShowHappyMascot(true);

      if (happyTimeoutRef.current) {
        window.clearTimeout(happyTimeoutRef.current);
      }

      happyTimeoutRef.current = window.setTimeout(() => {
        setShowHappyMascot(false);
      }, 2000);
    }

    previousStatusStateRef.current = status.state;

    return () => {
      if (happyTimeoutRef.current) {
        window.clearTimeout(happyTimeoutRef.current);
      }
    };
  }, [status.state]);

  useEffect(() => {
    if (!isClaudeCodeConversation) {
      setPanelHost(null);
      return;
    }

    const updatePanelHost = () => setPanelHost(resolvePanelHost());
    const messagesContainer = document.querySelector<HTMLElement>(
      `[data-messages-container][data-channel-id="${selectedDmChannelId}"]`
    );
    const observer = new MutationObserver(updatePanelHost);

    updatePanelHost();
    observer.observe(messagesContainer ?? document.body, {
      childList: true,
      subtree: true
    });

    return () => observer.disconnect();
  }, [isClaudeCodeConversation, resolvePanelHost, selectedDmChannelId]);

  useEffect(() => {
    if (!isClaudeCodeConversation) {
      setMascotRect(DEFAULT_MASCOT_RECT);
      return;
    }

    const updateMascotRect = () => {
      const messagesContainer = document.querySelector<HTMLElement>(
        `[data-messages-container][data-channel-id="${selectedDmChannelId}"]`
      );
      const bounds = messagesContainer?.getBoundingClientRect();

      if (!bounds) {
        setMascotRect(DEFAULT_MASCOT_RECT);
        return;
      }

      setMascotRect({
        left: Math.max(8, bounds.left + 4),
        bottom: Math.max(0, window.innerHeight - bounds.bottom - 2)
      });
    };
    const messagesContainer = document.querySelector<HTMLElement>(
      `[data-messages-container][data-channel-id="${selectedDmChannelId}"]`
    );
    const resizeObserver = new ResizeObserver(updateMascotRect);

    updateMascotRect();
    window.addEventListener('resize', updateMascotRect);

    if (messagesContainer) {
      resizeObserver.observe(messagesContainer);
    }

    return () => {
      window.removeEventListener('resize', updateMascotRect);
      resizeObserver.disconnect();
    };
  }, [isClaudeCodeConversation, selectedDmChannelId]);

  useEffect(() => {
    if (!isClaudeCodeConversation) {
      wsRef.current?.close();
      wsRef.current = null;

      return;
    }

    outputBufferRef.current = '';

    const connect = () => {
      const ws = new WebSocket(getWsUrl());

      wsRef.current = ws;

      ws.onopen = () => {
        terminalRef.current?.writeln('\r\n[connected]');
        sendResize();
      };

      ws.onmessage = (event) => {
        const message = JSON.parse(event.data) as TPtyMessage;

        if (message.type === 'output') {
          outputBufferRef.current = `${outputBufferRef.current}${message.data}`.slice(
            -200_000
          );
          terminalRef.current?.write(message.data);
        } else if (message.type === 'status') {
          setStatus(message.status);

          if (message.status.lastError) {
            terminalRef.current?.writeln(
              `\r\n[ClaudeCode error] ${message.status.lastError}`
            );
          }
        }
      };

      ws.onclose = () => {
        if (wsRef.current === ws) {
          wsRef.current = null;
        }

        setStatus((current) => ({
          ...current,
          connected: false,
          updatedAt: Date.now()
        }));
      };
    };

    connect();

    return () => {
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [isClaudeCodeConversation, sendResize]);

  useEffect(() => {
    if (!dmResolved || isClaudeCodeConversation) return;

    wsRef.current?.close();
    wsRef.current = null;
    closeClaudeCodeHistoryPanel();

    if (status.state === 'running' || status.state === 'waiting_for_user') {
      closeClaudeCodePanel();

      return;
    }

    closeClaudeCodePanel();
    void getTRPCClient().agents.stopClaudeCodeSession.mutate().catch(() => undefined);
  }, [dmResolved, isClaudeCodeConversation, status.state]);

  const refreshHistory = useCallback(async () => {
    setHistoryLoading(true);

    try {
      setHistoryItems(
        await getTRPCClient().agents.listClaudeCodeSessions.query()
      );
    } catch {
      toast.error('加载 ClaudeCode 历史会话失败');
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isClaudeCodeConversation || !historyOpen) return;

    void refreshHistory();
  }, [historyOpen, isClaudeCodeConversation, refreshHistory]);

  const resumeHistory = useCallback(
    async (chatSessionId: string) => {
      try {
        const result =
          await getTRPCClient().agents.resumeClaudeCodeSession.mutate({
            chatSessionId
          });

        closeClaudeCodeHistoryPanel();
        closeClaudeCodePanel();
        toast.success(
          result.rebound
            ? '已切换历史会话，并自动重建 Claude 绑定'
            : '已切换 ClaudeCode 历史会话'
        );
      } catch {
        toast.error('恢复 ClaudeCode 历史会话失败');
      }
    },
    []
  );

  const deleteHistory = useCallback(
    async (chatSessionId: string) => {
      try {
        await getTRPCClient().agents.deleteClaudeCodeSession.mutate({
          chatSessionId
        });
        toast.success('已删除 ClaudeCode 历史会话');
        await refreshHistory();
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : '删除 ClaudeCode 历史会话失败'
        );
      }
    },
    [refreshHistory]
  );

  const togglePanelFromMascot = useCallback(() => {
    closeClaudeCodeHistoryPanel();

    if (open || historyOpen) {
      closeClaudeCodePanel();
      setPanelHost(null);
      return;
    } else {
      openClaudeCodePanel();
    }

    window.setTimeout(scrollToPanelHost, 0);
    window.setTimeout(scrollToPanelHost, 120);
  }, [historyOpen, open, scrollToPanelHost]);

  const isClaudeCodeBusy =
    status.state === 'running' || status.state === 'waiting_for_user';
  const mascotSrc = showHappyMascot
    ? '/claude-code/happy.svg'
    : isClaudeCodeBusy
      ? '/claude-code/working.svg'
      : '/claude-code/standby.svg';

  if (!isClaudeCodeConversation) {
    return null;
  }

  return (
    <>
      <button
        type="button"
        className={cn(
          'pointer-events-auto fixed z-50 flex items-center justify-center overflow-visible rounded-none transition-transform duration-200 hover:scale-105',
          isClaudeCodeBusy && 'drop-shadow-[0_0_12px_rgba(52,211,153,0.65)]'
        )}
        style={{
          left: mascotRect.left,
          bottom: mascotRect.bottom,
          width: MASCOT_SIZE,
          height: MASCOT_SIZE
        }}
        title={open ? '定位并关闭 ClaudeCode 终端' : '定位并展开 ClaudeCode 终端'}
        onClick={togglePanelFromMascot}
      >
        <img
          src={mascotSrc}
          alt="ClaudeCode"
          className="h-full w-full object-contain"
          draggable={false}
        />
      </button>

      {panelHost &&
        (open || historyOpen) &&
        createPortal(
          <div
            className={cn(
              'aspect-[2/1] w-[min(720px,calc(100vw-8rem))] max-w-full origin-top transition-all duration-300 ease-out',
              open || historyOpen
                ? 'scale-100 opacity-100'
                : 'scale-95 opacity-0 pointer-events-none'
            )}
          >
            <section
              className={cn(
                'h-full w-full overflow-hidden rounded-md border border-border/90 bg-black/88 shadow-2xl ring-1 ring-white/10 backdrop-blur-md',
                historyOpen ? 'pointer-events-auto' : 'pointer-events-none'
              )}
            >
          {historyOpen ? (
            <div className="flex h-full flex-col bg-card/95 text-foreground">
              <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
                <div className="min-w-0">
                  <div className="font-bold">历史会话</div>
                </div>
                <button
                  type="button"
                  className="text-sm text-muted-foreground hover:text-foreground"
                  onClick={refreshHistory}
                >
                  刷新
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-2">
                {historyLoading && (
                  <div className="px-3 py-4 text-sm text-muted-foreground">
                    加载中...
                  </div>
                )}
                {!historyLoading && historyItems.length === 0 && (
                  <div className="px-3 py-4 text-sm text-muted-foreground">
                    暂无历史会话
                  </div>
                )}
                {!historyLoading &&
                  historyItems.map((item) => (
                    <div
                      key={item.id}
                      className={cn(
                        'mb-2 flex w-full gap-2 rounded-none border border-border bg-background/60 px-3 py-3 transition-colors hover:bg-accent',
                        item.current && 'border-emerald-400/70 bg-emerald-400/10'
                      )}
                    >
                      <button
                        type="button"
                        className="min-w-0 flex-1 text-left"
                        onClick={() => resumeHistory(item.id)}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span className="truncate text-sm font-semibold">
                            {new Date(item.updatedAt).toLocaleString()}
                          </span>
                          {item.current && (
                            <span className="shrink-0 text-xs text-emerald-300">
                              当前
                            </span>
                          )}
                        </div>
                        <div className="mt-1 truncate font-mono text-xs text-muted-foreground">
                          {item.id}
                        </div>
                        {!item.available && (
                          <div className="mt-2 text-xs text-amber-300">
                            Claude 绑定失效，切换时会自动重建
                          </div>
                        )}
                      </button>
                      <div className="flex shrink-0 items-start pt-0.5">
                        <button
                          type="button"
                          className={cn(
                            'flex h-8 w-8 items-center justify-center rounded-none text-muted-foreground transition-colors hover:bg-destructive/20 hover:text-destructive',
                            item.current && 'cursor-not-allowed opacity-35 hover:bg-transparent hover:text-muted-foreground'
                          )}
                          title={
                            item.current
                              ? '正在使用的会话不能删除，请先切换到其他会话'
                              : '删除历史会话'
                          }
                          disabled={item.current}
                          onClick={() => deleteHistory(item.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          ) : (
            <div
              ref={terminalContainerRef}
              className="pointer-events-auto h-full bg-black p-2"
              onMouseDown={() => terminalRef.current?.focus()}
            />
          )}
            </section>
          </div>,
          panelHost
        )}
    </>
  );
});

export { ClaudeCodeFloatingPanel };
