# Menu-bar companion app. The TS daemon/CLI builds with pnpm — these
# targets only cover the Swift app in app/.
.PHONY: app install-app

app:
	bash scripts/build-app.sh

install-app: app
	rm -rf /Applications/InboxMinder.app
	cp -R build/InboxMinder.app /Applications/InboxMinder.app
	@echo "Installed /Applications/InboxMinder.app — launch it via Spotlight."
	@echo "It expects a live inboxminder install (inboxminder up); quitting it never stops the daemon."
