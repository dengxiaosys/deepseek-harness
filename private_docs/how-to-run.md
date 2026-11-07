``` shell
tmux new-session -s dsh-web -c /home/dengxiao.cs/code_repos/deepseek-harness \
  'node --import tsx/esm apps/cli/src/bin.ts web --no-open --port 3080'
```