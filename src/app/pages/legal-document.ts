import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { LegalDoc } from './legal-text';

/**
 * The Privacy Policy or Terms of Use, from legal-text.ts (generated from
 * docs/legal/*.md by docs/legal/build-legal-text.mjs). The text is static and
 * bundled, so it renders on the server for search engines.
 */
@Component({
  selector: 'forum-legal-document',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let d = doc();
    <article class="legal-doc panel">
      <h1>{{ d.title }}</h1>
      <p class="legal-meta">{{ d.meta }}</p>
      <ng-container *ngTemplateOutlet="blocksTpl; context: { $implicit: d.intro }" />
      @for (section of d.sections; track section.heading) {
        <section>
          <h2>{{ section.heading }}</h2>
          <ng-container *ngTemplateOutlet="blocksTpl; context: { $implicit: section.blocks }" />
        </section>
      }
    </article>

    <ng-template #blocksTpl let-blocks>
      @for (b of blocks; track $index) {
        @switch (b.kind) {
          @case ('p') {
            <p [innerHTML]="b.html"></p>
          }
          @case ('sub') {
            <h3 [innerHTML]="b.html"></h3>
          }
          @case ('ul') {
            <ul>
              @for (item of b.items; track $index) {
                <li [innerHTML]="item"></li>
              }
            </ul>
          }
          @case ('ol') {
            <ol>
              @for (item of b.items; track $index) {
                <li [innerHTML]="item"></li>
              }
            </ol>
          }
          @case ('table') {
            <div class="legal-table">
              <table>
                <thead>
                  <tr>
                    @for (h of b.head; track $index) {
                      <th scope="col" [innerHTML]="h"></th>
                    }
                  </tr>
                </thead>
                <tbody>
                  @for (row of b.rows; track $index) {
                    <tr>
                      @for (cell of row; track $index) {
                        <td [innerHTML]="cell"></td>
                      }
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }
        }
      }
    </ng-template>
  `,
  styles: `
    .legal-doc {
      max-width: 800px;
      margin-inline: auto;
      line-height: 1.6;
    }
    .legal-meta {
      color: var(--muted, #6b6b7b);
      font-size: 0.875rem;
      margin-bottom: 1.5rem;
    }
    h2 {
      font-size: 1.25rem;
      margin: 2rem 0 0.75rem;
    }
    h3 {
      font-size: 1rem;
      margin: 1.25rem 0 0.5rem;
    }
    p {
      margin: 0 0 0.75rem;
    }
    ul,
    ol {
      margin: 0 0 0.75rem;
      padding-left: 1.25rem;
    }
    li {
      margin-bottom: 0.375rem;
    }
    .legal-table {
      overflow-x: auto;
      margin: 0.5rem 0 1rem;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.875rem;
    }
    th,
    td {
      text-align: left;
      vertical-align: top;
      padding: 0.5rem 0.75rem;
      border-bottom: 1px solid var(--line, #e5e0ec);
    }
    th {
      font-weight: 600;
    }
  `,
  imports: [NgTemplateOutlet],
})
export class LegalDocument {
  readonly doc = input.required<LegalDoc>();
}
