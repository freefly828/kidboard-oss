# Firmware bootstrap notes

Target hardware baseline: ESP32-S3-DevKitC-1-N8R8.

The real firmware project must be created by ESP-IDF tooling during Phase 5, then copy/adapt `partitions.csv` and validated `sdkconfig.defaults`.

Do not blindly assume Kconfig names across ESP-IDF major versions. Baseline this package against ESP-IDF 6.1.x, then pin an exact 6.1.x patch release in the firmware project and CI image. Revalidate Kconfig names whenever moving to another major/minor release.

Board pins must live in one board configuration module and remain changeable without editing driver/business logic.
