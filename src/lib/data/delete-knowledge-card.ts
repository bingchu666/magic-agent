type DeleteKnowledgeCardOperations = {
  deleteCard: () => Promise<void>;
  deleteThread?: () => Promise<void>;
  onThreadCleanupError?: (error: unknown) => void;
};

/**
 * The knowledge_cards.thread_id foreign key uses ON DELETE RESTRICT, so the
 * owning card must be removed before its thread can be cleaned up.
 */
export async function deleteCardBeforeThread(
  operations: DeleteKnowledgeCardOperations
) {
  await operations.deleteCard();
  if (!operations.deleteThread) return;

  try {
    await operations.deleteThread();
  } catch (error) {
    operations.onThreadCleanupError?.(error);
  }
}
