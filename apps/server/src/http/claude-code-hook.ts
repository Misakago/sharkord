import { getErrorMessage } from '@mikotord/shared';
import http from 'http';
import { claudeCodeAgentManager } from '../agents/claude-code';
import { logger } from '../logger';
import { getJsonBody, sendJsonError } from './helpers';

const claudeCodeStopHookRouteHandler = async (
  req: http.IncomingMessage,
  res: http.ServerResponse
) => {
  const url = new URL(req.url ?? '', `http://${req.headers.host || 'localhost'}`);
  const token = url.searchParams.get('token');

  if (!token) {
    sendJsonError(res, 401, 'Missing hook token');
    return;
  }

  try {
    const body = await getJsonBody(req);
    const handled = await claudeCodeAgentManager.handleStopHook(token, body);

    if (!handled) {
      sendJsonError(res, 404, 'Unknown ClaudeCode session');
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  } catch (error) {
    logger.error('ClaudeCode stop hook failed: %s', getErrorMessage(error));
    await claudeCodeAgentManager.handleHookFailure(
      token,
      `ClaudeCode hook failed: ${getErrorMessage(error)}`
    );
    sendJsonError(res, 500, 'ClaudeCode hook failed');
  }
};

const claudeCodeAskUserQuestionHookRouteHandler = async (
  req: http.IncomingMessage,
  res: http.ServerResponse
) => {
  req.setTimeout(0);
  res.setTimeout(0);

  const url = new URL(req.url ?? '', `http://${req.headers.host || 'localhost'}`);
  const token = url.searchParams.get('token');

  if (!token) {
    sendJsonError(res, 401, 'Missing hook token');
    return;
  }

  try {
    const body = await getJsonBody(req);
    const response = await claudeCodeAgentManager.handleAskUserQuestionHook(
      token,
      body
    );

    if (!response) {
      sendJsonError(res, 404, 'Unknown ClaudeCode session');
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(response));
  } catch (error) {
    logger.error(
      'ClaudeCode AskUserQuestion hook failed: %s',
      getErrorMessage(error)
    );
    await claudeCodeAgentManager.handleHookFailure(
      token,
      `ClaudeCode AskUserQuestion hook failed: ${getErrorMessage(error)}`
    );
    sendJsonError(res, 500, 'ClaudeCode AskUserQuestion hook failed');
  }
};

const claudeCodeMessageLookupRouteHandler = async (
  req: http.IncomingMessage,
  res: http.ServerResponse
) => {
  const url = new URL(req.url ?? '', `http://${req.headers.host || 'localhost'}`);
  const token = url.searchParams.get('token');
  const match = /^\/claude-code\/messages\/(\d+)$/.exec(url.pathname);
  const messageId = match ? Number(match[1]) : undefined;

  if (!token) {
    sendJsonError(res, 401, 'Missing hook token');
    return;
  }

  if (!messageId) {
    sendJsonError(res, 400, 'Missing message id');
    return;
  }

  try {
    const message = await claudeCodeAgentManager.getMessageDetailsForHook(
      token,
      messageId
    );

    if (!message) {
      sendJsonError(res, 404, 'Message not found');
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(message));
  } catch (error) {
    logger.error('ClaudeCode message lookup failed: %s', getErrorMessage(error));
    sendJsonError(res, 500, 'ClaudeCode message lookup failed');
  }
};

export {
  claudeCodeAskUserQuestionHookRouteHandler,
  claudeCodeMessageLookupRouteHandler,
  claudeCodeStopHookRouteHandler
};
