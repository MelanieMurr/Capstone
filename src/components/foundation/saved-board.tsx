"use client";
import Workspace from "../workspace";
import type { BoardDocument } from "../../lib/board/model";
import { useSharedBoard } from "../../lib/collaboration/use-shared-board";

export default function SavedBoard({ id, title, document, canEdit }: { id: string; title: string; document: BoardDocument; revision: number; canEdit: boolean }) {
  const live = useSharedBoard(id);
  return <Workspace initialDocument={document} identity={{ id, title }} live={live}
    readOnly={!canEdit || !live.connected || !live.canEdit} remoteStatus={live.status} />;
}
