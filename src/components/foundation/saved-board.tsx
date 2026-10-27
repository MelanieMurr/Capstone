"use client";
import BoardSharing from "./board-sharing";
import Workspace from "../workspace";
import type { BoardDocument } from "../../lib/board/model";
import { useSharedBoard } from "../../lib/collaboration/use-shared-board";

export default function SavedBoard({ id, title, document, canEdit, isOwner }: { id: string; title: string; document: BoardDocument; revision: number; canEdit: boolean; isOwner: boolean }) {
  const live = useSharedBoard(id);
  return <Workspace initialDocument={document} identity={{ id, title }} live={live} sharePanel={<BoardSharing id={id} isOwner={isOwner} />}
    readOnly={!canEdit || !live.connected || !live.canEdit} remoteStatus={live.status} />;
}
