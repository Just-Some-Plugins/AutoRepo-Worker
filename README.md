# AutoRepo-Worker

This script is designed to get around the limitation in GitHub
building where an action in one repository cannot be 
triggered by another repository.
This limitation combined with the inability to easily add 
actions to a contribution-focused fork of a plugin (you would 
have to constantly remove them pre-PR),
makes it difficult to auto-build your fork for tester's to use.

This [worker](https://autorepo.justsome.site/worker)
script can receive webhooks from such forks of plugin 
repositories, with a key stored in
[AutoRepo's Repository Variables](https://github.com/Just-Some-Plugins/AutoRepo/settings/variables/actions),
and then comment on [an issue](https://github.com/Just-Some-Plugins/AutoRepo/issues/1) on
[AutoRepo](https://github.com/Just-Some-Plugins/AutoRepo), to 
trigger a build of the plugin there - which will fetch the 
fork and build it, then push the built fork to AutoRepo-Web 
to go into a Custom Repo.

# Usage

<blockquote><details><summary>

## Webhook Setup Instructions

</summary>

To use this worker, you need to set up a webhook on your 
plugin's repository.

1. Go to your repository's settings.
2. Go to `Webhooks`.
3. Click `Add webhook`.
4. Set the `Payload URL` to `https://autorepo.justsome.site/trigger/...`
   - Replace the `...` with your desired variables from below.
5. Set the `Content type` to `application/json`.
6. Set the `Secret` to the key you were given.
   - Your key must have access to the repos you attempt to 
     trigger [here](https://github.com/Just-Some-Plugins/AutoRepo/settings/variables/actions/ALLOWED_REPOS_FOR_USERS)
     in `ALLOWED_REPOS_FOR_USERS`.
7. Select `Let me select individual events` and select 
   `Branch or tag creation`.
8. Click `Add webhook`.

</details></blockquote>

## Hook Variables

```
https://autorepo.justsome.site
/trigger/<repo>[/<repo2>[/<repo3>...]]
                    [?target_name=<name>]
                    [&main=<branch>]
                    [&test=<branch>]
                    [&main_build=<main's build configuration>]
                    [&test_build=<test's build configuration>]
                    [&icon=<link to icon png>]
```

|               |     | Req                | Description                                                                                                                                                                          | Example                  |
|---------------|-----|--------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|--------------------------|
| `repo`        | URL | :heavy_check_mark: | The name of the repo to trigger your plugin into.<br>The repos must be in [`ALLOWED_REPOS`](https://github.com/Just-Some-Plugins/AutoRepo/settings/variables/actions/ALLOWED_REPOS). | `/trigger/jsp`           |
| other `repo`s | URL | :x:                | Additional repos to trigger.                                                                                                                                                         | `/trigger/jsp/zbee`      |
| `target_name` | GET | :white_circle:     | The name of your plugin.<br>Defaults to the name of your repo if not set.<br>Underscores will be replaced with spaces.<br>                                                           | `&target_name=My_Plugin` |
| `main`        | GET | :white_circle:     | The branch that is the live version of the plugin.<br/>Defaults to the pushed branch if `main` and `test` are not set.                                                               | `&main=master`           |
| `main_build`  | GET | :white_circle:     | The csproj build configuration to use for the main branch.<br/>Defaults to `Release`.                                                                                                | `&main_build=rel`        |
| `test`        | GET | :x:                | The branch that is the test version of the plugin.                                                                                                                                   | `&test=testing`          |
| `test_build`  | GET | :white_circle:     | The csproj build configuration to use for the test branch.<br/>Defaults to `Debug`.                                                                                                  | `&test_build=dev`        |
| `icon`        | GET | :x:                | The URL of the PNG icon to use for the plugin.                                                                                                                                       | `&icon=https://...`      |

- If you do not set `main` or `test`, or the branch that was 
  pushed does not match either of them, `target_name` will 
  have the branch name appended to it, eg `My Plugin (dev_branch)`.

**Some examples:**
> https://autorepo.justsome.site/trigger/jsp?target_name=My_Plugin&test=dev
> 
> https://autorepo.justsome.site/trigger/jsp/individual?main=drk_tests

<blockquote><details><summary>

## Troubleshooting Webhooks

</summary>

If you are having trouble with the webhook, you can refer to the
Recent Deliveries section of your webhook's settings to see what
the worker replied with.

Additionally, you can check [the trigger log issue](https://github.com/Just-Some-Plugins/AutoRepo/issues/1)
for the triggering data from the worker; specifically the 
collapsed section `Raw Trigger Data` at the bottom of the 
most recent comment regarding your plugin.

You may also check the [latest build](https://github.com/Just-Some-Plugins/AutoRepo/actions)
to see if the build script is failing for some reason with 
your plugin.

Finally, you can copy the link to the specific trigger log 
comment and post a new issue to AutoRepo with the link.

</details></blockquote>

<details><summary>

# Setup

</summary>

## Worker Variables

These Environment Variables are required to be present on the
worker.

| Variable Name | Value                                                                 | Link                                                             |
|---------------|-----------------------------------------------------------------------|------------------------------------------------------------------|
| Read_Keys     | Fine-Grained PAT with Repository: Variables: Read, on AutoRepo        | [->](https://github.com/settings/personal-access-tokens/3693504) |
| Issue_Comment | Fine-Grained PAT with Repository: Issues: Read and Write, on AutoRepo | [->](https://github.com/settings/personal-access-tokens/3693515) |

## Repository Variables

These Actions Variables are required to be present on 
AutoRepo, the repository that the worker is triggering builds on.

Setup under `Secrets and Variables` > `Actions` > `Variables` in
the repository settings.

| Variable Name           | Value                                                                                                                                         | Link                                                                                                   |
|-------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------|--------------------------------------------------------------------------------------------------------|
| ALLOWED_REPOS           | A comma-separated list of plugin repository choices allowed. Spaces/line-breaks permitted                                                     | [->](https://github.com/Just-Some-Plugins/AutoRepo/settings/variables/actions/ALLOWED_REPOS)           |
| ALLOWED_REPOS_FOR_USERS | A line-break-separated list of key owner's names, a colon, then a comma-separated list of plugin repositories they can access, or `*` or `-`. | [->](https://github.com/Just-Some-Plugins/AutoRepo/settings/variables/actions/ALLOWED_REPOS_FOR_USERS) |

### `ALLOWED_REPOS` example
```
just-some-plugins,
dev,
zbee-personal
```

### `ALLOWED_REPOS_FOR_USERS` example
```
zbee: *
alice: just-some-plugins, dev
testing: -
```

### Key example
Yes, ideally keys would be secrets instead of variables, but 
it is not possible to read secrets via the GitHub API.

> *Variable name:* `zbee`, 
`zbee__fork`
> 
> *Value:* `<key value>`

The name of the variable before two underscores is the name of
the user who owns the key.

So, `zbee__fork` is another key for `zbee`.
And because in `ALLOWED_REPOS_FOR_USERS` `zbee` has `*` 
access in the above example, `zbee` and `zbee__fork` keys can 
both be used to access any plugin repository.

</details>

---

> [!TIP]
> This code should only ever need to change with
> - [GitHub Webhook changes](https://github.blog/changelog/label/webhooks/),
> - [GitHub API changes](https://github.blog/changelog/label/api,apis/), or
> - [Discord Webhook changes](https://discord.com/developers/docs/change-log).

    AutoRepo-Worker: a worker script to trigger GitHub builds with Webhooks.
    Copyright (C) 2024  Ethan Henderson (zbee) <ethan@zbee.codes>

     This program is free software: you can redistribute it and/or modify
     it under the terms of the GNU Affero General Public License as published
     by the Free Software Foundation, either version 3 of the License, or
     (at your option) any later version.

     This program is distributed in the hope that it will be useful,
     but WITHOUT ANY WARRANTY; without even the implied warranty of
     MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
     GNU Affero General Public License for more details.

     You should have received a copy of the GNU Affero General Public License
     along with this program. If not, see <https://www.gnu.org/licenses/>. 
