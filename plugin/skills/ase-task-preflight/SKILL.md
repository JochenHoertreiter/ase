---
name: ase-task-preflight
argument-hint: "[--help|-h] [--next|-n <option>[,...]] [<id>]"
description: >
    Preflight the implementation of current or given task plan.
    Use when the user calls to "preflight", "dry-run" or "test-drive"
    the "task", "plan", "spec", or "specification".
user-invocable: true
disable-model-invocation: false
effort: xhigh
---

@${CLAUDE_SKILL_DIR}/../../meta/ase-control.md
@${CLAUDE_SKILL_DIR}/../../meta/ase-skill.md
@${CLAUDE_SKILL_DIR}/../../meta/ase-dialog.md
@${CLAUDE_SKILL_DIR}/../../meta/ase-getopt.md

<purpose name="ase-task-preflight">
Preflight a Task Plan
</purpose>

<expand name="getopt"
    arg1="ase-task-preflight"
    arg2="--next|-n=(none|DONE|EDIT|IMPLEMENT)... --int-reuse-task">
    $ARGUMENTS
</expand>

<objective>
*Preflight* the implementation of a task plan by creating a draft
for a corresponding, *complete source code change set*.
</objective>

@${CLAUDE_SKILL_DIR}/../../meta/ase-format-task.md
@${CLAUDE_SKILL_DIR}/../../meta/ase-common-task.md
@${CLAUDE_SKILL_DIR}/../../meta/ase-tenets.md
@${CLAUDE_SKILL_DIR}/../../meta/ase-common-code.md

Procedure
---------

1.  **Determine Task:**

    1.  Set <instruction><getopt-arguments/></instruction> initially, with any
        leading and trailing whitespace stripped.
        Inherit the always existing <ase-task-id/> from the current context.
        Inherit the always existing <ase-session-id/> from the current context.
        Do not output anything.

    2.  React on task id:

        <expand name="task-react-id" arg1="ase-task-preflight"></expand>

2.  **Determine Operation:**

    1.  Determine the current task plan content:

        <expand name="task-load-content"></expand>

    2.  If the <task-content/> is still empty, complain and tell the user to
        use the `ase-code-resolve`, `ase-code-refactor`, `ase-code-craft`,
        or `ase-task-edit` skills first to create a task plan. Then
        immediately stop processing this skill.

    3.  Internalize the tenets stated by the plan:

        <expand name="code-tenets-from-plan"></expand>

3.  **Create Implementation Draft:**

    1.  Determine the *draft base* <draft-base/> -- the artifact state
        the draft is drafted against -- mirroring the branch handling
        of the companion skill `ase-task-implement`: Set <task-branch/>
        to the value of the `Branch:` frontmatter key of
        <task-content/>, or to the literal `current` if the key is
        absent. Determine the *checked-out branch* by running the
        command `git branch --show-current` (taken exactly as given)
        and capturing its output into <current-branch/>.

        <if condition="<task-branch/> is `current` or equal to <current-branch/>">
        The implementation lands in the current working copy, so set
        <draft-base></draft-base> (empty): the draft is based on the
        *working copy* content of the artifacts.
        </if>
        <elseif condition="the branch <task-branch/> exists according to `git branch --list`">
        The implementation lands in a worktree of this *existing*
        branch, so set <draft-base><task-branch/></draft-base>.
        </elseif>
        <else>
        The implementation lands in a worktree of this branch *created*
        from `HEAD`, so set <draft-base>HEAD</draft-base>.
        </else>

        Do not output anything.

    2.  Perform a *preflight* of the *implementation* of <task-content/> by creating a
        draft for a corresponding, *complete artifact change set*
        which *would* fully implement the task plan <task-content/>. Store
        this artifact change set in *unified diff* format in <unified-diff/>.

        Create this draft with the *same rigor* as the final
        implementation of the companion skill `ase-task-implement`,
        because that skill later takes the draft over *1:1* -- the user
        is assumed to review the draft in between. Hence *read* the
        current content of *every* artifact the draft touches before
        drafting its hunks -- from the working copy if <draft-base/> is
        empty, or via `git show "<draft-base/>:<path/>"` otherwise --,
        so all context lines match the artifacts *exactly* as the final
        implementation will find them and the diff would apply
        *cleanly*, and honor the task plan and the internalized tenets
        just as the final implementation would. Only the actual
        modification of the artifacts and the verification phase are
        deferred to `ase-task-implement`.

        You *MUST* *skip* every bullet-point of <task-content/> in
        checkbox state `[-]` (cancelled) or `[>]` (deferred), exactly as
        `ase-task-implement` does: the draft neither realizes its
        <text/> nor prepares its check, and its checkbox stays
        *untouched*. Its <text/> stays *context only*.

        You *MUST* also *skip* every bullet-point of <task-content/> in
        checkbox state `[x]` (done), exactly as `ase-task-implement`
        does: it was already fully resolved by a previous run, so the
        draft neither realizes its <text/> again nor prepares its check
        again. Its <text/> stays *context only*, too.

        You *MUST* treat every bullet-point of <task-content/> in
        checkbox state `[?]` (question) exactly like one in state `[ ]`
        (todo), i.e., as a *regular* todo, as its grilling question just
        stayed unanswered: the draft realizes its <text/> or prepares its
        check.

        You *MUST* *re-examine* every bullet-point of <task-content/> in
        checkbox state `[/]` (incomplete), as a previous run resolved it
        only *partially*: check which parts of its <text/> are not yet
        realized or verified by the artifacts, and let the draft realize
        or prepare the check of *only* these remaining parts.

        The checkboxes of all bullet-points stay *untouched*, as only
        `ase-task-implement` updates them.

    3.  Update <timestamp-modified/> with the current time in
        ISO-style format, which has to be determined by calling the
        `ase_timestamp(format: "yyyy-LL-dd HH:mm")` tool of the `ase`
        MCP server and using the `text` field of its response. This
        value stamps the attachment below *only* -- the `Modified:`
        frontmatter key tracks "body" changes and stays *untouched*, so
        the fresh draft is *never* stale. Do not output anything.

    4.  Append this artifact change set <unified-diff/> as an
        *attachment block* to the "backmatter" of <task-content/> with
        the following <template/>, closely following the plan <format/>. If an
        attachment block with the `Type` key value `text/x-diff; charset=utf-8;
        kind="preflight"` already exists from a previous run of this skill,
        *replace* this entire existing attachment block in place.

        Set <timestamp-attachment-created/> to the value of the `Created`
        key of the *replaced* attachment block, so the creation time of
        the draft survives its replacement, or to <timestamp-modified/>
        if no such block or key exists.

        Set <payload/> to <unified-diff/> with *every* line -- including
        empty lines -- indented by *exactly* 4 spaces, so the YAML literal
        block scalar of the `Data` key carries the diff *verbatim*. The
        "body" keeps its trailing empty line directly before the `---`
        line of the attachment block.

        <template>
        ---
        Type:     text/x-diff; charset=utf-8; kind="preflight"
        Created:  <timestamp-attachment-created/>
        Modified: <timestamp-modified/>
        Data:     |4+
        <payload/>
        </template>

    5.  Finally, call the `ase_task_save(id: "<ase-task-id/>",
        text: "<task-content/>")` tool of the `ase` MCP server to save the updated
        task plan content. This `ase_task_save` MCP tool call is the
        *only* permitted way to persist the plan -- *NEVER* write the
        plan file via `Write`/`Edit` or by executing a shell command.
        Do not output anything related to this MCP tool call
        except the following <template/>:

        <template>
        ⧉ **ASE**: ◉ task: **<ase-task-id/>**, ▶ status: **plan updated**
        </template>

4.  **Decide Next Step:**

    1.  *Determine next step*:

        <expand name="task-next-select"
            arg1="ase-task-preflight"
            arg2="DONE|EDIT|IMPLEMENT">
            Next Step: How would you like to proceed with the plan?
            DONE: Stop processing.
            EDIT: Hand processing off to editing.
            IMPLEMENT: Hand processing off to implementation.
        </expand>

    2.  Check the tool <result/> and dispatch accordingly:

        -   If <result/> is `DONE` or `CANCEL`:
            Only output the following <template/> and then *STOP*.

            <template>
            ⧉ **ASE**: ◉ task: **<ase-task-id/>**, ▶ status: **plan updated -- done**
            </template>

        -   If <result/> is `EDIT`:
            <expand name="task-next-handoff" arg1="ase-task-edit"
                arg2="plan updated -- hand-off to edit"></expand>

        -   If <result/> is `IMPLEMENT`:
            <expand name="task-next-handoff" arg1="ase-task-implement"
                arg2="plan updated -- hand-off to implementation"></expand>

