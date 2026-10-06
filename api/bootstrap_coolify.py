"""Initialize the standalone WMS schema and its bundled mapping registration."""

import os

import psycopg2

from bootstrap_railway import main as initialize_schema


def main() -> None:
    initialize_schema()
    # The API image ships autosav.yaml. Its source must exist in the local
    # allowlist before mapping_loader can boot. This registers a mapping only:
    # it creates no token and makes no connection to any external database.
    connection = psycopg2.connect(os.environ["DATABASE_URL"])
    try:
        with connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    INSERT INTO inbound_source_systems_allowlist
                        (source_system, kind, notes)
                    VALUES ('autosav', 'connector', 'Bundled Autosav mapping')
                    ON CONFLICT (source_system) DO NOTHING
                    """
                )
    finally:
        connection.close()
    print("Standalone WMS schema and bundled mapping registration ready.")


if __name__ == "__main__":
    main()
