This script is designed to get around the limitation in GitHub building where an action in one repository cannot be triggered by another repository.

This limitation combined with the inability to easily add action to a contribution-focused fork of a plugin makes it difficult to auto-build your fork for tester's to use.

This script is designed to receive webhooks from such forks, with a key stored in AutoRepo's Repository Variables, and then comment on an issue on AutoRepo, to trigger a build there - which will fetch the fork and build it, then push the built fork to AutoRepo-Web to go into a Custom Repo.

---

This code should only ever need to change with Github Webhook, Github API, or Discord Webhook changes.

---

Copyright 2024 Ethan Henderson (zbee)

     This program is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.

    This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for more details.

    You should have received a copy of the GNU General Public License along with this program. If not, see <https://www.gnu.org/licenses/>. 