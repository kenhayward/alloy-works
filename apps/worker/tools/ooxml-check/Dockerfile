# The Word validator: the Open XML SDK's OpenXmlValidator over one .docx, built by
# `pnpm --filter @alloy-works/worker fetch-ooxml-check` and run by `checkOoxml` in
# apps/worker/src/testing/ooxml.ts. Both images are pinned by digest and the package by its lock
# file, so every machine and CI validate with the same bytes.

# mcr.microsoft.com/dotnet/sdk:8.0, as pulled on 2026-09-25.
FROM mcr.microsoft.com/dotnet/sdk@sha256:78235e09001f52b6592c458ac010775ebac6725422e80cd0c1650590f67b2743 AS build
WORKDIR /src
COPY nuget.config OoxmlCheck.csproj packages.lock.json ./
# Locked mode: a package the lock file does not name, or one whose content hash differs, fails the
# build rather than being resolved afresh.
RUN dotnet restore --locked-mode
COPY Program.cs ./
RUN dotnet publish --no-restore --configuration Release --output /out

# mcr.microsoft.com/dotnet/runtime:8.0, as pulled on 2026-09-25.
FROM mcr.microsoft.com/dotnet/runtime@sha256:37466ea190f696105c1c3ae67c15e32d4e199face9a0b2ad5b9a37c464db8f30
WORKDIR /app
COPY --from=build /out ./
# The image's own unprivileged user; the checked file is mounted readable by all.
USER app
ENTRYPOINT ["dotnet", "/app/OoxmlCheck.dll"]
