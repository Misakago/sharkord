import { UserAvatar } from '@/components/user-avatar';
import { getRenderedUsername } from '@/helpers/get-rendered-username';
import { computePosition } from '@floating-ui/dom';
import type { TJoinedPublicUser } from '@mikotord/shared';
import type { Editor } from '@tiptap/core';
import { ReactRenderer } from '@tiptap/react';
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useState
} from 'react';

const MENTION_STORAGE_KEY = 'mentionUsers';

type TUserListProps = {
  items: TJoinedPublicUser[];
  onSelect: (item: TJoinedPublicUser) => void;
};

export type TUserListRef = {
  onKeyDown: (event: KeyboardEvent) => boolean;
};

const UserList = forwardRef<TUserListRef, TUserListProps>(
  ({ items, onSelect }, ref) => {
    const [selectedIndex, setSelectedIndex] = useState(0);

    useEffect(() => setSelectedIndex(0), [items]);

    const selectItem = useCallback(
      (index: number) => items[index] && onSelect(items[index]),
      [items, onSelect]
    );

    const onKeyDown = useCallback(
      (e: KeyboardEvent): boolean => {
        if (items.length === 0) return false;

        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setSelectedIndex((i) => (i <= 0 ? items.length - 1 : i - 1));

          return true;
        }

        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setSelectedIndex((i) => (i >= items.length - 1 ? 0 : i + 1));

          return true;
        }

        if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault();
          selectItem(selectedIndex);

          return true;
        }

        if (e.key === 'Escape') return false;

        return false;
      },
      [items, selectItem, selectedIndex]
    );

    useImperativeHandle(ref, () => ({ onKeyDown }));

    if (items.length === 0) return null;

    return (
      <div
        data-suggestion-popover
        className="isolate min-w-[16rem] max-w-88 max-h-60 overflow-y-auto rounded-lg border border-border bg-[#262626] p-1 text-card-foreground opacity-100 shadow-xl z-50"
        style={{ backgroundColor: '#262626', opacity: 1 }}
        role="listbox"
        aria-label="Mention user"
      >
        {items.map((item, index) => (
          <button
            key={item.id}
            type="button"
            role="option"
            aria-selected={index === selectedIndex}
            className={`flex h-10 w-full cursor-default select-none items-center gap-2 rounded-lg px-2 text-left text-sm outline-none transition-colors hover:bg-[#333333] hover:text-accent-foreground focus:bg-[#333333] focus:text-accent-foreground ${
              index === selectedIndex
                ? 'bg-[#333333] text-accent-foreground'
                : 'bg-[#262626]'
            }`}
            style={{
              backgroundColor: index === selectedIndex ? '#333333' : '#262626'
            }}
            onClick={() => onSelect(item)}
          >
            <UserAvatar userId={item.id} className="h-8 w-8 shrink-0" />
            <span className="font-medium truncate">
              {getRenderedUsername(item)}
            </span>
          </button>
        ))}
      </div>
    );
  }
);

const reposition = (component: ReactRenderer | null, clientRect: DOMRect) => {
  if (!component?.element) return;

  const virtual = { getBoundingClientRect: () => clientRect };

  computePosition(virtual, component.element, { placement: 'top-start' }).then(
    (pos) => {
      if (component?.element)
        Object.assign(component.element.style, {
          left: `${pos.x}px`,
          top: `${pos.y}px`,
          position: pos.strategy === 'fixed' ? 'fixed' : 'absolute'
        });
    }
  );
};

const cleanup = (component: ReactRenderer | null) => {
  if (component?.element && document.body.contains(component.element)) {
    document.body.removeChild(component.element);
  }

  component?.destroy();
};

type TSuggestionProps = {
  editor: Editor;
  query: string;
  clientRect?: (() => DOMRect | null) | null;
  command: (item: TJoinedPublicUser) => void;
};

const MentionSuggestion = {
  items: ({
    editor,
    query
  }: {
    editor: Editor;
    query: string;
  }): TJoinedPublicUser[] => {
    const users: TJoinedPublicUser[] =
      (
        editor.storage as unknown as Record<
          string,
          { users?: TJoinedPublicUser[] }
        >
      )[MENTION_STORAGE_KEY]?.users ?? [];

    if (!query) return users.slice(0, 10);

    const q = query.toLowerCase();

    return users
      .filter((u) => getRenderedUsername(u).toLowerCase().includes(q))
      .sort((a, b) => {
        const aName = getRenderedUsername(a).toLowerCase();
        const bName = getRenderedUsername(b).toLowerCase();

        const aS = aName.startsWith(q);
        const bS = bName.startsWith(q);

        if (aS && !bS) return -1;
        if (!aS && bS) return 1;

        return aS && bS ? aName.length - bName.length : 0;
      })
      .slice(0, 10);
  },
  allowSpaces: false,
  render: () => {
    let component: ReactRenderer | null = null;
    return {
      onStart(props: TSuggestionProps) {
        const items = MentionSuggestion.items({
          editor: props.editor,
          query: props.query
        });
        const onSelect = (item: TJoinedPublicUser) => {
          props.command(item);

          cleanup(component);

          component = null;
        };
        component = new ReactRenderer(UserList, {
          props: { items, onSelect },
          editor: props.editor
        });

        Object.assign(component.element.style, {
          backgroundColor: '#262626',
          borderRadius: '0.5rem',
          opacity: '1',
          zIndex: '50'
        });

        document.body.appendChild(component.element);

        const rect = props.clientRect?.();

        if (rect) {
          reposition(component, rect);
        }
      },
      onUpdate(props: TSuggestionProps) {
        const items = MentionSuggestion.items({
          editor: props.editor,
          query: props.query
        });
        component?.updateProps({
          items,
          onSelect: (item: TJoinedPublicUser) => {
            props.command(item);

            cleanup(component);

            component = null;
          }
        });
        const rect = props.clientRect?.();

        if (rect) {
          reposition(component, rect);
        }
      },
      onKeyDown(props: { event: KeyboardEvent }) {
        const ref = component?.ref as TUserListRef | undefined;

        return ref?.onKeyDown(props.event) ?? false;
      },
      onExit() {
        cleanup(component);
        component = null;
      }
    };
  }
};

export { MENTION_STORAGE_KEY, MentionSuggestion };
