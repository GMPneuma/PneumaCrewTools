# Crew Tools development

This checkout targets Foundry v13; its integration branch is `foundry-v13`.

- Preserve existing uncommitted work.
- Maintain v12 on main and develop v13 on foundry-v13 in separate D:/Git/PneumaCrewTools-v12 and D:/Git/PneumaCrewTools-v13 folders.
- V12 keeps https://github.com/GMPneuma/PneumaCrewTools/releases/latest/download/module.json as its update feed.
- V13 uses https://raw.githubusercontent.com/GMPneuma/PneumaCrewTools/foundry-v13/static/module.json as its update feed. The packaged v13 manifest must retain that same URL.
- Publish v13 releases as prereleases with make_latest=false until explicitly approved for general release. Never replace the existing latest v12 release during v13 development.
- Publish matching release assets before advancing an update manifest. Do not advertise a development manifest as installable until its ZIP contains the same manifest channel, version, and compatibility.
- Use unique release tags across both branches.
- Selectively port relevant v12 fixes from main to foundry-v13; never merge the v13 migration into main while main maintains v12.
- Keep compatibility minimum and maximum at 13.
- Run relevant tests and typecheck/build before releasing.
- Build with ./scripts/deploy-local.ps1. Deploy with -Deploy -ServerStopped only after confirming the matching server is stopped.
- crewtools-target.json binds this checkout to W:/data/foundry13; do not redirect it to the other version.
- Keep separate test worlds; never migrate a v12 test world in place for v13 testing.
