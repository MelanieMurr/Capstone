import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { userInfo } from "node:os";
const socket = process.env.COCANVAS_COMMENT_TEST_SOCKET;
test("comment RLS: authorship, moderation, membership, deletion and immutable history", { skip: !socket }, async () => {
  assert.ok(socket!.startsWith("/private/tmp/cocanvas-comment"), "Use only an isolated synthetic local database");
  const db = new Client({ host: socket!, port: 55439, database: "postgres", user: userInfo().username });
  await db.connect(); await db.query("begin");
  const owner = randomUUID(), editor = randomUUID(), viewer = randomUUID(), outsider = randomUUID();
  const a = randomUUID(), b = randomUUID();
  const claims = async (id: string) => { await db.query("reset role"); await db.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: id, email: `${id}@example.com`, role: "authenticated" })]); await db.query("set local role authenticated"); };
  const denied = async (sql: string, values: unknown[]) => {
    await db.query("savepoint expected_failure");
    await assert.rejects(db.query(sql, values));
    await db.query("rollback to savepoint expected_failure"); await db.query("release savepoint expected_failure");
  };
  try {
    for (const id of [owner, editor, viewer, outsider]) await db.query("insert into auth.users(id,email) values($1,$2)", [id, `${id}@example.com`]);
    await claims(owner);
    const board = (await db.query("select (public.create_board('Comment test')).id")).rows[0].id;
    await db.query("insert into public.board_collaborators(board_id,user_id,permission) values($1,$2,'editor'),($1,$3,'viewer')", [board, editor, viewer]);
    const save = async (objects: unknown[]) => db.query("update public.board_documents set snapshot=$2,revision=revision+1 where board_id=$1", [board, { schemaVersion: 1, boardId: board, objects }]);
    const noteA = { id: a, type: "sticky-note", text: "Owner's note" }, noteB = { id: b, type: "sticky-note", text: "Editor's note" };
    await save([noteA]); await claims(editor); await save([noteA, noteB]);
    assert.equal((await db.query("select author_id from public.board_note_authors where board_id=$1 and note_id=$2", [board, b])).rows[0].author_id, editor);
    await denied("update public.board_note_authors set author_id=$1 where board_id=$2", [viewer, board]);
    await claims(viewer);
    assert.equal((await save([noteA])).rowCount, 0, "Viewer must not write canvas content");
    const insert = async (note: string, body = "Please review") => (await db.query("insert into public.board_note_comments(board_id,note_id,body) values($1,$2,$3) returning *", [board, note, body])).rows[0];
    const pending = await insert(b, "<script>plain text only</script>");
    assert.equal((await db.query("select public.board_comment_counts($1) as counts", [board])).rows[0].counts[b], 1);
    assert.equal(pending.author_id, viewer); assert.equal(pending.status, "pending");
    await denied("insert into public.board_note_comments(board_id,note_id,body,author_id) values($1,$2,'Forged',$3)", [board,b,editor]);
    await denied("insert into public.board_note_comments(board_id,note_id,body,status) values($1,$2,'Forged','approved')", [board,b]);
    assert.equal((await db.query("update public.board_note_comments set status='approved' where id=$1 returning id", [pending.id])).rowCount, 0);
    await claims(owner);
    assert.equal((await db.query("select * from public.board_note_comments where id=$1", [pending.id])).rowCount, 0, "Owner is not automatically the reviewer of another active member's note");
    assert.deepEqual((await db.query("select public.board_comment_counts($1) as counts", [board])).rows[0].counts, {});
    await claims(editor);
    assert.equal((await db.query("select * from public.board_note_comments where id=$1", [pending.id])).rowCount, 1);
    const approved = (await db.query("update public.board_note_comments set status='approved' where id=$1 returning *", [pending.id])).rows[0];
    assert.equal(approved.reviewed_by, editor);
    await db.query("update public.board_note_comments set status='approved' where id=$1", [pending.id]);
    await denied("update public.board_note_comments set status='rejected' where id=$1", [pending.id]);
    await denied("update public.board_note_comments set body='Changed' where id=$1", [pending.id]);
    await claims(owner); assert.equal((await db.query("select * from public.board_note_comments where id=$1", [pending.id])).rowCount, 1);
    await claims(outsider);
    assert.equal((await db.query("select * from public.board_note_comments where board_id=$1", [board])).rowCount, 0);
    await denied("insert into public.board_note_comments(board_id,note_id,body) values($1,$2,'No access')", [board,b]);
    assert.equal((await db.query("select public.board_note_reviewer($1,$2) as id", [board,b])).rows[0].id, null);
    await claims(owner); await db.query("delete from public.board_collaborators where board_id=$1 and user_id=$2", [board,editor]);
    await claims(editor); assert.equal((await db.query("select * from public.board_note_comments where board_id=$1", [board])).rowCount, 0);
    await claims(viewer); const fallback = await insert(b);
    await claims(owner); assert.equal((await db.query("select public.board_note_reviewer($1,$2) as id", [board,b])).rows[0].id, owner);
    await db.query("update public.board_note_comments set status='rejected' where id=$1", [fallback.id]);
    await claims(viewer); assert.equal((await db.query("select status from public.board_note_comments where id=$1", [fallback.id])).rows[0].status, "rejected");
    await claims(owner); await save([noteA]);
    await db.query("insert into public.board_collaborators(board_id,user_id,permission) values($1,$2,'editor')", [board,editor]);
    await claims(editor); await save([noteA,noteB]);
    assert.equal((await db.query("select author_id from public.board_note_authors where board_id=$1 and note_id=$2", [board,b])).rows[0].author_id, editor);
    await claims(viewer); assert.equal((await db.query("select * from public.board_note_comments where note_id=$1", [b])).rowCount, 0, "Deleted note comments must not reappear after undo");
    await claims(owner); await save([noteB]); await claims(editor); await save([noteA,noteB]);
    assert.equal((await db.query("select author_id from public.board_note_authors where note_id=$1", [a])).rows[0].author_id, owner, "Reusing a note ID must not steal authorship");
    await claims(viewer); const historical = await insert(b, "Historical approval");
    await claims(editor); await db.query("update public.board_note_comments set status='approved' where id=$1", [historical.id]);
    await db.query("reset role"); await db.query("delete from auth.users where id=$1", [editor]);
    await claims(owner);
    assert.equal((await db.query("select public.board_note_reviewer($1,$2) as id", [board,b])).rows[0].id, owner);
    assert.equal((await db.query("select reviewed_by from public.board_note_comments where id=$1", [historical.id])).rows[0].reviewed_by, editor);
    await db.query("reset role");
    assert.equal((await db.query("select count(*)::int as count from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef")).rows[0].count, 0, "No public security-definer entry point");
  } finally { await db.query("rollback"); await db.end(); }
});

test("comment review races and deletion/creation locking", { skip: !socket }, async () => {
  assert.ok(socket!.startsWith("/private/tmp/cocanvas-comment"));
  const config = { host: socket!, port: 55439, database: "postgres", user: userInfo().username };
  const db = new Client(config), first = new Client(config), second = new Client(config);
  await Promise.all([db.connect(), first.connect(), second.connect()]);
  const owner = randomUUID(), noteId = randomUUID(); let board: string | undefined;
  async function begin(client: Client) {
    await client.query("begin"); await client.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: owner, email: "local@example.com", role: "authenticated" })]);
    await client.query("set local role authenticated");
  }
  try {
    await db.query("insert into auth.users(id) values($1)", [owner]); await begin(db);
    board = (await db.query("select (public.create_board('Race fixture')).id")).rows[0].id;
    const snapshot = { schemaVersion: 1, boardId: board, objects: [{ id: noteId, type: "sticky-note" }] };
    await db.query("update public.board_documents set snapshot=$2,revision=revision+1 where board_id=$1", [board,snapshot]);
    const id = (await db.query("insert into public.board_note_comments(board_id,note_id,body) values($1,$2,'Review race') returning id", [board,noteId])).rows[0].id;
    await db.query("commit");
    await begin(first); await begin(second);
    await first.query("update public.board_note_comments set status='approved' where id=$1", [id]);
    const rejected = second.query("update public.board_note_comments set status='rejected' where id=$1", [id]);
    const rejection = assert.rejects(rejected, (error: unknown) => (error as { code: string }).code === "23514");
    await first.query("commit"); await rejection; await second.query("rollback");
    await begin(first); await begin(second);
    await first.query("insert into public.board_note_comments(board_id,note_id,body) values($1,$2,'Insertion race')", [board,noteId]);
    const deletion = second.query("update public.board_documents set snapshot=$2,revision=revision+1 where board_id=$1", [board,{ ...snapshot, objects: [] }]);
    await first.query("commit"); await deletion; await second.query("commit");
    await db.query("reset role");
    assert.equal((await db.query("select count(*)::int as count from public.board_note_comments where board_id=$1", [board])).rows[0].count, 0);
  } finally {
    await Promise.all([first.query("rollback"),second.query("rollback")]); await db.query("reset role");
    if (board) await db.query("delete from public.boards where id=$1", [board]);
    await db.query("delete from auth.users where id=$1", [owner]);
    await Promise.all([db.end(),first.end(),second.end()]);
  }
});
