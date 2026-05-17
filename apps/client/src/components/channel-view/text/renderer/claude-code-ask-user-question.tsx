import { getTRPCClient } from '@/lib/trpc';
import { cn } from '@/lib/utils';
import type {
  TClaudeCodeAskUserQuestion,
  TClaudeCodeAskUserQuestionAnswers,
  TClaudeCodeAskUserQuestionMetadata
} from '@mikotord/shared';
import { Button, Input } from '@mikotord/ui';
import { Check, Circle, CircleCheck, Square, SquareCheck, X } from 'lucide-react';
import { memo, useCallback, useMemo, useState } from 'react';
import { toast } from 'sonner';

type TClaudeCodeAskUserQuestionProps = {
  question: TClaudeCodeAskUserQuestionMetadata;
};

const getStatusLabel = (status: TClaudeCodeAskUserQuestionMetadata['status']) => {
  if (status === 'answered') return '已回答';
  if (status === 'cancelled') return '已取消';
  if (status === 'expired') return '已超时';

  return '等待回答';
};

const hasStoredAnswer = (
  answers: TClaudeCodeAskUserQuestionAnswers | undefined,
  question: TClaudeCodeAskUserQuestion
) => {
  const answer = answers?.[question.question];

  if (Array.isArray(answer)) return answer.length > 0;

  return Boolean(answer);
};

const formatStoredAnswer = (
  answers: TClaudeCodeAskUserQuestionAnswers | undefined,
  question: TClaudeCodeAskUserQuestion
) => {
  const answer = answers?.[question.question];

  if (Array.isArray(answer)) return answer.join(', ');

  return answer ?? '未回答';
};

const ClaudeCodeAskUserQuestion = memo(
  ({ question }: TClaudeCodeAskUserQuestionProps) => {
    const [selectedAnswers, setSelectedAnswers] = useState<Record<string, string[]>>(
      {}
    );
    const [customEnabled, setCustomEnabled] = useState<Record<string, boolean>>({});
    const [customAnswers, setCustomAnswers] = useState<Record<string, string>>({});
    const [submitting, setSubmitting] = useState(false);
    const isPending = question.status === 'pending';

    const toggleOption = useCallback(
      (prompt: TClaudeCodeAskUserQuestion, label: string) => {
        setSelectedAnswers((current) => {
          const existing = current[prompt.question] ?? [];

          if (!prompt.multiSelect) {
            return { ...current, [prompt.question]: [label] };
          }

          const next = existing.includes(label)
            ? existing.filter((item) => item !== label)
            : [...existing, label];

          return { ...current, [prompt.question]: next };
        });

        if (!prompt.multiSelect) {
          setCustomEnabled((current) => ({
            ...current,
            [prompt.question]: false
          }));
        }
      },
      []
    );

    const toggleCustom = useCallback((prompt: TClaudeCodeAskUserQuestion) => {
      setCustomEnabled((current) => {
        const enabled = !current[prompt.question];

        if (enabled && !prompt.multiSelect) {
          setSelectedAnswers((selected) => ({
            ...selected,
            [prompt.question]: []
          }));
        }

        return { ...current, [prompt.question]: enabled };
      });
    }, []);

    const answers = useMemo<TClaudeCodeAskUserQuestionAnswers>(() => {
      return question.questions.reduce<TClaudeCodeAskUserQuestionAnswers>(
        (acc, prompt) => {
          const selected = selectedAnswers[prompt.question] ?? [];
          const custom = customEnabled[prompt.question]
            ? customAnswers[prompt.question]?.trim()
            : undefined;

          if (prompt.multiSelect) {
            acc[prompt.question] = custom ? [...selected, custom] : selected;
          } else {
            acc[prompt.question] = custom || selected[0] || '';
          }

          return acc;
        },
        {}
      );
    }, [customAnswers, customEnabled, question.questions, selectedAnswers]);

    const canSubmit = useMemo(
      () =>
        question.questions.every((prompt) => {
          const answer = answers[prompt.question];

          if (Array.isArray(answer)) return answer.length > 0;

          return Boolean(answer);
        }),
      [answers, question.questions]
    );

    const submit = useCallback(async () => {
      if (!canSubmit || submitting) return;

      setSubmitting(true);

      try {
        await getTRPCClient().agents.answerClaudeCodeQuestion.mutate({
          requestId: question.requestId,
          answers
        });
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : '提交 ClaudeCode 回答失败'
        );
      } finally {
        setSubmitting(false);
      }
    }, [answers, canSubmit, question.requestId, submitting]);

    const cancel = useCallback(async () => {
      if (submitting) return;

      setSubmitting(true);

      try {
        await getTRPCClient().agents.cancelClaudeCodeQuestion.mutate({
          requestId: question.requestId
        });
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : '取消 ClaudeCode 问题失败'
        );
      } finally {
        setSubmitting(false);
      }
    }, [question.requestId, submitting]);

    return (
      <div className="mt-1 flex w-full max-w-xl flex-col gap-3 rounded-md border border-sky-400/25 bg-sky-500/10 p-3 text-sm text-sky-50">
        <div className="flex items-center justify-between gap-3">
          <div className="font-medium text-sky-100">ClaudeCode 需要确认</div>
          <span
            className={cn(
              'rounded-sm border px-2 py-0.5 text-xs',
              isPending
                ? 'border-amber-300/30 bg-amber-300/10 text-amber-100'
                : 'border-sky-300/20 bg-sky-300/10 text-sky-100'
            )}
          >
            {getStatusLabel(question.status)}
          </span>
        </div>

        {question.questions.map((prompt) => (
          <div key={prompt.question} className="flex flex-col gap-2">
            <div>
              <div className="text-xs font-semibold uppercase text-sky-200/70">
                {prompt.header}
              </div>
              <div className="mt-0.5 text-sky-50">{prompt.question}</div>
            </div>

            {isPending ? (
              <>
                <div className="grid gap-2">
                  {prompt.options.map((option) => {
                    const selected = (
                      selectedAnswers[prompt.question] ?? []
                    ).includes(option.label);
                    const Icon = prompt.multiSelect
                      ? selected
                        ? SquareCheck
                        : Square
                      : selected
                        ? CircleCheck
                        : Circle;

                    return (
                      <button
                        key={option.label}
                        type="button"
                        className={cn(
                          'flex items-start gap-2 rounded-md border px-3 py-2 text-left transition-colors',
                          selected
                            ? 'border-sky-300/70 bg-sky-300/15 text-white'
                            : 'border-sky-300/20 bg-black/15 text-sky-50 hover:bg-sky-300/10'
                        )}
                        onClick={() => toggleOption(prompt, option.label)}
                      >
                        <Icon className="mt-0.5 h-4 w-4 shrink-0" />
                        <span className="min-w-0">
                          <span className="block font-medium">{option.label}</span>
                          {option.description && (
                            <span className="mt-0.5 block text-xs text-sky-100/65">
                              {option.description}
                            </span>
                          )}
                        </span>
                      </button>
                    );
                  })}
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className={cn(
                      'flex h-9 shrink-0 items-center gap-2 rounded-md border px-3 text-left text-xs transition-colors',
                      customEnabled[prompt.question]
                        ? 'border-sky-300/70 bg-sky-300/15'
                        : 'border-sky-300/20 bg-black/15 hover:bg-sky-300/10'
                    )}
                    onClick={() => toggleCustom(prompt)}
                  >
                    {customEnabled[prompt.question] ? (
                      prompt.multiSelect ? (
                        <SquareCheck className="h-4 w-4" />
                      ) : (
                        <CircleCheck className="h-4 w-4" />
                      )
                    ) : prompt.multiSelect ? (
                      <Square className="h-4 w-4" />
                    ) : (
                      <Circle className="h-4 w-4" />
                    )}
                    其他
                  </button>
                  <Input
                    value={customAnswers[prompt.question] ?? ''}
                    disabled={!customEnabled[prompt.question]}
                    placeholder="输入自定义回答"
                    className="h-9 border-sky-300/20 bg-black/15 text-sky-50 placeholder:text-sky-100/40"
                    onChange={(event) =>
                      setCustomAnswers((current) => ({
                        ...current,
                        [prompt.question]: event.target.value
                      }))
                    }
                  />
                </div>
              </>
            ) : (
              <div
                className={cn(
                  'rounded-md border px-3 py-2',
                  hasStoredAnswer(question.answers, prompt)
                    ? 'border-sky-300/20 bg-black/15 text-sky-50'
                    : 'border-muted/30 bg-muted/20 text-muted-foreground'
                )}
              >
                {formatStoredAnswer(question.answers, prompt)}
              </div>
            )}
          </div>
        ))}

        {isPending && (
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-sky-100 hover:bg-sky-300/10 hover:text-white"
              disabled={submitting}
              onClick={cancel}
            >
              <X className="h-4 w-4" />
              取消
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={!canSubmit || submitting}
              onClick={submit}
            >
              <Check className="h-4 w-4" />
              提交
            </Button>
          </div>
        )}
      </div>
    );
  }
);

export { ClaudeCodeAskUserQuestion };
