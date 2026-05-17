import { cn } from '@/lib/utils';
import MDEditor from '@uiw/react-md-editor';
import '@uiw/react-md-editor/markdown-editor.css';
import { memo, useMemo } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { Virtuoso } from 'react-virtuoso';
import { getTextFileLanguage } from './text-file-preview-helpers';

type TTextFilePreviewProps = {
  content: string;
  name: string;
  extension: string;
  mimeType?: string;
  fullHeight?: boolean;
};

type TCodeLineProps = {
  line: string;
  lineNumber: number;
  language: string;
};

const CodeLine = memo(({ line, lineNumber, language }: TCodeLineProps) => {
  const lineContent = line || ' ';

  return (
    <div className="flex min-w-max text-sm leading-6">
      <span className="w-14 shrink-0 select-none pr-4 text-right text-muted-foreground/55">
        {lineNumber}
      </span>
      {language === 'text' ? (
        <span className="font-mono whitespace-pre text-foreground">
          {lineContent}
        </span>
      ) : (
        <SyntaxHighlighter
          language={language}
          style={oneDark}
          PreTag="span"
          CodeTag="span"
          customStyle={{
            display: 'inline',
            margin: 0,
            background: 'transparent',
            padding: 0,
            overflow: 'visible'
          }}
          codeTagProps={{
            style: {
              fontFamily:
                'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
              whiteSpace: 'pre'
            }
          }}
        >
          {lineContent}
        </SyntaxHighlighter>
      )}
    </div>
  );
});

const TextFilePreview = memo(
  ({
    content,
    name,
    extension,
    mimeType,
    fullHeight
  }: TTextFilePreviewProps) => {
    const language = useMemo(
      () => getTextFileLanguage({ name, extension, mimeType }),
      [extension, mimeType, name]
    );
    const isMarkdown = language === 'markdown';
    const displayContent = useMemo(() => content, [content]);
    const lines = useMemo(
      () => displayContent.split(/\r\n|\r|\n/),
      [displayContent]
    );

    if (isMarkdown) {
      return (
        <div
          className={cn(
            'w-full max-w-full overflow-auto rounded-md bg-transparent p-3',
            fullHeight ? 'min-h-0 flex-1' : 'max-h-[min(35vh,18rem)]'
          )}
          data-color-mode="dark"
        >
          <MDEditor.Markdown
            source={displayContent}
            className="!bg-transparent text-sm"
          />
        </div>
      );
    }

    return (
      <div
        className={cn(
          'w-full max-w-full overflow-hidden rounded-md bg-transparent',
          fullHeight ? 'min-h-0 flex-1' : 'h-[clamp(12rem,22.5vh,18rem)]'
        )}
      >
        <Virtuoso
          className="h-full w-full bg-transparent"
          data={lines}
          increaseViewportBy={fullHeight ? 900 : 500}
          itemContent={(index, line) => (
            <CodeLine line={line} lineNumber={index + 1} language={language} />
          )}
        />
      </div>
    );
  }
);

export { TextFilePreview };
