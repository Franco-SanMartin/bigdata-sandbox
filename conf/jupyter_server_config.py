# JupyterLab del sandbox (version ml de la imagen). Lo prende el arranque del
# contenedor con JUPYTER=si (el valor por defecto): http://localhost:8888
c = get_config()  # noqa: F821 (lo define Jupyter al leer este archivo)

c.ServerApp.ip = "0.0.0.0"          # que se vea desde la compu (con -p 8888:8888)
c.ServerApp.port = 8888
c.ServerApp.open_browser = False    # adentro del contenedor no hay navegador
c.ServerApp.allow_root = True       # todo el sandbox corre como root

# Sin token ni contrasena, como el resto del sandbox: entrar es abrir la
# pagina. Por eso el puerto se publica SOLO para tu compu (-p 127.0.0.1:8888:8888):
# abierto a la red del aula, cualquiera podria correr programas en tu contenedor.
c.IdentityProvider.token = ""
c.PasswordIdentityProvider.hashed_password = ""

# Los notebooks se guardan en /datos: la carpeta datos/ de tu compu
c.ServerApp.root_dir = "/datos"

# Las terminales de JupyterLab con bash (sin esto abren sh, sin historial ni
# autocompletar)
c.ServerApp.terminado_settings = {"shell_command": ["/bin/bash"]}

# No buscar actualizaciones en internet (en el aula no hace falta)
c.LabApp.check_for_updates_class = "jupyterlab.NeverCheckForUpdate"
