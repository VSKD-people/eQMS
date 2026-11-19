# Set-up kit

Everything needed to recreate the hosting and sign-in for VeQMS in a new account. Each folder covers
one platform. None of them hold passwords, keys or account IDs: you create those in the new account
and the scripts pass them straight to where they're needed.

The git history isn't included. It stays in the GitHub repository, which collaborators can clone.

| Folder | What it recreates | How |
|---|---|---|
| `vercel/` | The Vercel project and its settings | `project-settings.json` lists every setting; `README.md` gives the dashboard steps; `deploy-cli.sh` is an optional command-line route |
| `azure-entra/` | The Azure Static Web App and the Entra ID app registration for single sign-on | `README.md` gives the portal steps; `setup.sh` does the same with the Azure CLI |
| `github-secrets/` | The GitHub Actions secret the Azure deploy needs | `secrets.md` lists it; `set-secrets.sh` sets it with the GitHub CLI |

You only need one hosting route: Vercel or Azure. If you choose Vercel, you can skip `azure-entra/`
and `github-secrets/`.

**The scripts are untested.** They were written without access to Vercel, Azure or a new GitHub
account, from my knowledge of each command-line tool. Command names and flags change, so check each
one against the tool's current documentation before running it, and run the scripts one section at a
time the first time. The dashboard steps in each `README.md` are the safer route.
