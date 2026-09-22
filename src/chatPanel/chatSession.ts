import * as vscode from "vscode";
import { askAgent } from "./agent";

const SESSION_TYPE = "sessionCompanion";
const SCHEME = "session-companion";
const SESSION_RESOURCE = vscode.Uri.from({ scheme: SCHEME, path: "/skeleton" });

/**
 * Registers the extension as a session type in VS Code's built-in Chat panel
 * (uses the proposed `chatSessionsProvider` API — Extension Development Host only).
 */
export function registerChatSession(context: vscode.ExtensionContext): void {
  const participant = vscode.chat.createChatParticipant(
    "sessionCompanion.agent",
    async (request, _chatContext, stream) => {
      const text = await askAgent(request.prompt);
      stream.markdown(text);
    }
  );
  context.subscriptions.push(participant);

  const controller = vscode.chat.createChatSessionItemController(
    SESSION_TYPE,
    async () => {
      controller.items.replace([
        controller.createChatSessionItem(SESSION_RESOURCE, "Skeleton session"),
      ]);
    }
  );
  context.subscriptions.push(controller);

  const contentProvider = vscode.chat.registerChatSessionContentProvider(
    SCHEME,
    {
      provideChatSessionContent: () => ({
        history: [],
        requestHandler: async (request, _chatContext, stream) => {
          const text = await askAgent(request.prompt);
          stream.markdown(text);
        },
      }),
    },
    participant
  );
  context.subscriptions.push(contentProvider);
}
