<script setup lang="ts">
const navItems = [
  { label: 'Library', icon: 'i-lucide-library', active: true },
  { label: 'Search', icon: 'i-lucide-search' },
  { label: 'Stats', icon: 'i-lucide-chart-no-axes-column' },
  { label: 'Tables', icon: 'i-lucide-table-2' },
  { label: 'Backups', icon: 'i-lucide-archive' },
  { label: 'Settings', icon: 'i-lucide-settings-2' },
]

const folders = [
  { name: 'Novel Drafts', articles: 128, accent: 'bg-emerald-500' },
  { name: 'Fragments', articles: 74, accent: 'bg-sky-500' },
  { name: 'Journal', articles: 412, accent: 'bg-amber-500' },
  { name: 'Deleted', articles: 239, accent: 'bg-rose-500' },
]

const articles = [
  {
    title: 'The City Under Rain',
    excerpt: 'A quiet chapter opening with lights moving behind glass.',
    count: '4,821',
    updated: 'Jul 19',
    active: true,
  },
  {
    title: 'Blue Notebook Notes',
    excerpt: 'Loose observations, names, small turns of phrase.',
    count: '1,248',
    updated: 'Jul 16',
    active: false,
  },
  {
    title: 'Archive Recovery Checklist',
    excerpt: 'Export format, metadata, and restoration checkpoints.',
    count: '982',
    updated: 'Jul 11',
    active: false,
  },
]
</script>

<template>
  <main
    class="min-h-screen bg-slate-50 text-slate-950 transition-colors dark:bg-slate-950 dark:text-slate-50"
  >
    <header
      class="border-b border-slate-200 bg-white/80 backdrop-blur dark:border-slate-800 dark:bg-slate-950/80"
    >
      <div class="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3 sm:px-6">
        <div class="flex min-w-0 flex-1 items-center gap-3">
          <div
            class="grid size-9 shrink-0 place-items-center rounded-md bg-emerald-600 text-white shadow-sm shadow-emerald-900/20"
          >
            <UIcon name="i-lucide-pen-line" class="size-5" />
          </div>
          <div class="min-w-0">
            <p class="truncate text-sm font-semibold text-slate-950 dark:text-white">
              Writer Archive
            </p>
            <p class="truncate text-xs text-slate-500 dark:text-slate-400">
              Private writing workspace
            </p>
          </div>
        </div>

        <div class="flex items-center gap-2">
          <UColorModeSelect
            color="neutral"
            variant="subtle"
            size="sm"
            class="w-32 sm:w-36"
            aria-label="Theme"
          />
          <UButton
            icon="i-lucide-lock-keyhole"
            color="neutral"
            variant="ghost"
            aria-label="Session"
          />
        </div>
      </div>
    </header>

    <div
      class="mx-auto grid max-w-7xl gap-4 px-4 py-4 sm:px-6 lg:grid-cols-[220px_minmax(260px,340px)_1fr]"
    >
      <aside
        class="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900"
      >
        <nav class="grid gap-1">
          <UButton
            v-for="item in navItems"
            :key="item.label"
            :icon="item.icon"
            :label="item.label"
            :color="item.active ? 'primary' : 'neutral'"
            :variant="item.active ? 'soft' : 'ghost'"
            class="justify-start"
          />
        </nav>
      </aside>

      <section
        class="min-h-[520px] rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
      >
        <div class="border-b border-slate-200 p-3 dark:border-slate-800">
          <UInput
            icon="i-lucide-search"
            color="neutral"
            variant="subtle"
            placeholder="Search archive"
          />
        </div>

        <div class="grid gap-2 p-3">
          <button
            v-for="folder in folders"
            :key="folder.name"
            class="flex h-12 items-center gap-3 rounded-md px-3 text-left transition-colors hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <span :class="['size-2 rounded-full', folder.accent]" />
            <span class="min-w-0 flex-1">
              <span
                class="block truncate text-sm font-medium text-slate-900 dark:text-slate-100"
              >
                {{ folder.name }}
              </span>
              <span class="block text-xs text-slate-500 dark:text-slate-400">
                {{ folder.articles }} articles
              </span>
            </span>
          </button>
        </div>
      </section>

      <section
        class="min-h-[520px] overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
      >
        <div
          class="flex flex-wrap items-center gap-3 border-b border-slate-200 p-4 dark:border-slate-800"
        >
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <h1
                class="truncate text-lg font-semibold text-slate-950 dark:text-white"
              >
                Novel Drafts
              </h1>
              <UBadge color="primary" variant="subtle">Active</UBadge>
            </div>
            <p class="mt-1 text-sm text-slate-500 dark:text-slate-400">
              128 articles, ordered by latest update
            </p>
          </div>
          <UButton icon="i-lucide-plus" label="New Article" color="primary" />
        </div>

        <div class="grid lg:grid-cols-[minmax(240px,320px)_1fr]">
          <div
            class="border-b border-slate-200 dark:border-slate-800 lg:border-r lg:border-b-0"
          >
            <button
              v-for="article in articles"
              :key="article.title"
              class="grid w-full gap-1 border-b border-slate-100 p-4 text-left transition-colors last:border-b-0 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/70"
            >
              <span class="flex items-center gap-2">
                <span
                  class="truncate text-sm font-medium text-slate-900 dark:text-slate-100"
                >
                  {{ article.title }}
                </span>
                <span
                  v-if="article.active"
                  class="size-1.5 rounded-full bg-emerald-500"
                />
              </span>
              <span class="line-clamp-2 text-sm text-slate-500 dark:text-slate-400">
                {{ article.excerpt }}
              </span>
              <span class="text-xs text-slate-400 dark:text-slate-500">
                {{ article.count }} words - {{ article.updated }}
              </span>
            </button>
          </div>

          <article class="grid content-start gap-5 p-5">
            <div class="flex flex-wrap items-center gap-2">
              <UBadge color="secondary" variant="subtle">Autosave ready</UBadge>
              <UBadge color="neutral" variant="outline">
                Local draft recovery
              </UBadge>
            </div>

            <div>
              <h2
                class="text-2xl leading-tight font-semibold text-slate-950 dark:text-white"
              >
                The City Under Rain
              </h2>
              <p class="mt-2 text-sm text-slate-500 dark:text-slate-400">
                Updated Jul 19 - 4,821 words
              </p>
            </div>

            <div
              class="min-h-64 rounded-md border border-slate-200 bg-slate-50 p-4 text-base leading-8 text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200"
            >
              <p>
                Rain made the avenue feel handwritten, each reflection bent by the
                passing cars and the long amber windows above the station.
              </p>
              <p class="mt-4">
                She kept walking until the city quieted into a single rhythm:
                shoes, breath, water, light.
              </p>
            </div>

            <div class="flex flex-wrap justify-end gap-2">
              <UButton
                icon="i-lucide-panel-right-open"
                label="Metadata"
                color="neutral"
                variant="subtle"
              />
              <UButton icon="i-lucide-save" label="Save" color="primary" />
            </div>
          </article>
        </div>
      </section>
    </div>
  </main>
</template>
