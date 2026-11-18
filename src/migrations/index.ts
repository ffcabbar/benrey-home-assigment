import * as migration_20261118_005033_initial from './20261118_005033_initial';
import * as migration_20261118_005045_add_registration_constraints from './20261118_005045_add_registration_constraints';
import * as migration_20261118_101916_add_overlap_guard from './20261118_101916_add_overlap_guard';
import * as migration_20261118_150457_add_session_display_title from './20261118_150457_add_session_display_title';
import * as migration_20261118_150505_backfill_session_display_title from './20261118_150505_backfill_session_display_title';
import * as migration_20261118_150507_disable_locks_on_read_only_collections from './20261118_150507_disable_locks_on_read_only_collections';

export const migrations = [
  {
    up: migration_20261118_005033_initial.up,
    down: migration_20261118_005033_initial.down,
    name: '20261118_005033_initial',
  },
  {
    up: migration_20261118_005045_add_registration_constraints.up,
    down: migration_20261118_005045_add_registration_constraints.down,
    name: '20261118_005045_add_registration_constraints',
  },
  {
    up: migration_20261118_101916_add_overlap_guard.up,
    down: migration_20261118_101916_add_overlap_guard.down,
    name: '20261118_101916_add_overlap_guard',
  },
  {
    up: migration_20261118_150457_add_session_display_title.up,
    down: migration_20261118_150457_add_session_display_title.down,
    name: '20261118_150457_add_session_display_title',
  },
  {
    up: migration_20261118_150505_backfill_session_display_title.up,
    down: migration_20261118_150505_backfill_session_display_title.down,
    name: '20261118_150505_backfill_session_display_title',
  },
  {
    up: migration_20261118_150507_disable_locks_on_read_only_collections.up,
    down: migration_20261118_150507_disable_locks_on_read_only_collections.down,
    name: '20261118_150507_disable_locks_on_read_only_collections'
  },
];
