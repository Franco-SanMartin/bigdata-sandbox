# La terminal de la interfaz: lo mismo que `docker exec -it ... bash` (los mismos archivos de
# siempre) y, cada vez que vuelve el prompt, una marca invisible con el código de salida del
# último comando. La interfaz la usa para saber cuándo terminó lo que corrió una práctica.
[ -f /etc/bash.bashrc ] && . /etc/bash.bashrc
[ -f "$HOME/.bashrc" ] && . "$HOME/.bashrc"
__bds_marca() { printf '\033]777;bds;%s\007' "$1"; }
PROMPT_COMMAND="__bds_marca \$?${PROMPT_COMMAND:+; $PROMPT_COMMAND}"
