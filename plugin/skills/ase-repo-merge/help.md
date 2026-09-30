##  NAME

`ase-repo-merge` - Merge a Branch

##  SYNOPSIS

`ase-repo-merge`
    [`--help`|`-h`]
    [`--target`|`-t` *branch*]
    [`--mode`|`-m` `merge`|`rebase`|`squash`]
    [`--cleanup`|`-c`]
    *source-branch*

##  DESCRIPTION

The `ase-repo-merge` skill *merges* a Git *source-branch* into a target
branch and reports the result as a *merge verdict*: `MERGED`,
`CONFLICT`, or `FAILED`.

Still *uncommitted* changes in the worktree where the source branch is
checked out are first *committed* with a derived one-line commit
message of the form `<type>: <summary>`. The source branch is then
merged inside the worktree where the target branch is checked out,
which has to be free of uncommitted changes, in one of three modes: a
regular *merge* with a merge commit (`git merge --no-ff`), a *rebase*
of the source branch onto the target branch followed by a
fast-forward (`git rebase` plus `git merge --ff-only`), or a *squash*
of all source commits into one commit (`git merge --squash`).
Merge conflicts are *resolved semantically*, honoring the intents of
both sides and never losing any change, through the same procedure as
`ase-repo-resolve`. If a conflict is unresolvable, because both
intents contradict each other or no confident resolution exists, the
unresolvable conflicts are reported, the merge is *aborted*, the
target branch is left untouched, and the verdict is `CONFLICT`. Finally, the skill *checks*
that the source branch is contained in the target branch. It does
*not* build or test the merge result, so semantically resolved
conflicts still deserve a review.

On a `CONFLICT` or `FAILED` verdict, the commit of the previously
uncommitted source changes is *undone* again, so they are uncommitted
as before (but no longer partially staged).

If the source branch *equals* the target branch, only its uncommitted
changes are committed. The skill is also used by `ase agent integrator`
to drive the *Integration* phase of the `enterprise` task lifecycle
model headless. As the target branch is by default the checked-out
branch of the working copy of the project, any uncommitted change
there lets the merge of every task with its own branch fail, and hence
the task become `DEFERRED`, while for a task with an in-place change
set it is committed together with that change set. So, when running
the integrator, keep the working copy clean and do your own work in
separate worktrees.

##  OPTIONS

-   `--target`|`-t` *branch*:
    The target branch of the merge (default: `current`, the checked-out
    branch of the working copy).

-   `--mode`|`-m` `merge`|`rebase`|`squash`:
    The merge mode (default: `merge`): `merge` creates a merge commit,
    `rebase` rebases the source branch (rewriting its commits, in its
    own worktree if it is checked out) onto the target branch and
    fast-forwards the target branch, and `squash` combines all changes
    of the source branch into one new commit on the target branch.
    Conflicts are resolved per rebased commit under `rebase`.

-   `--cleanup`|`-c`:
    After a successful merge, remove the worktree of the source branch
    (if any) and delete the merged source branch.

##  ARGUMENTS

-   *source-branch*:
    The Git branch to merge.

##  SCENARIOS

-   You want a feature branch landed on the checked-out branch
-   You want the uncommitted result of a worktree committed and merged
-   You want merge conflicts resolved instead of hand-editing them

##  EXAMPLES

Merge the branch `feature-x` into the checked-out branch:

```text
❯ /ase-repo-merge feature-x
```

Merge the branch `feature-x` into `develop` and remove it afterwards:

```text
❯ /ase-repo-merge --target develop --cleanup feature-x
```

Squash the branch `feature-x` into one commit on the checked-out branch:

```text
❯ /ase-repo-merge --mode squash feature-x
```

##  SEE ALSO

[`ase-task-implement`](../ase-task-implement/help.md), [`ase-repo-resolve`](../ase-repo-resolve/help.md), [`ase-repo-review`](../ase-repo-review/help.md),
[`ase-repo-commit`](../ase-repo-commit/help.md), [`ase-repo-dissect`](../ase-repo-dissect/help.md).

