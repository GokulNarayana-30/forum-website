import { Component, computed, signal } from '@angular/core';

@Component({
  selector: 'app-root',
  styleUrl: './app.scss',
  templateUrl: './app.html',
})
export class App {
  protected readonly query = signal('');
  protected readonly category = signal('All tests');
  protected readonly expanded = signal('');
  protected readonly notice = signal('');
  protected readonly categories = ['All tests', 'Diabetes', 'Thyroid', 'Heart health', 'Vitamins'];
  protected readonly tests = [
    {
      name: 'HbA1c',
      category: 'Diabetes',
      label: 'Glycated haemoglobin',
      image: 'cat_diabetes.webp',
      description:
        'A blood test that measures glycated haemoglobin. Your clinician can help you understand whether this test is appropriate for you.',
    },
    {
      name: 'Thyroid profile',
      category: 'Thyroid',
      label: 'Thyroid function testing',
      image: 'cat_thyroid.webp',
      description:
        'A group of blood tests relating to thyroid function. The confirmed panel inclusions will be shown with the live catalog.',
    },
    {
      name: 'Lipid profile',
      category: 'Heart health',
      label: 'Cholesterol testing',
      image: 'cat_heart.webp',
      description:
        'A panel that measures blood lipids. The confirmed panel inclusions will be shown with the live catalog.',
    },
    {
      name: 'Vitamin B12',
      category: 'Vitamins',
      label: 'Vitamin level testing',
      image: 'cat_vitamins.webp',
      description:
        'A blood test that measures vitamin B12 levels. Ask your clinician whether testing is suitable for you.',
    },
  ];
  protected readonly filteredTests = computed(() =>
    this.tests.filter(
      (test) =>
        (this.category() === 'All tests' || this.category() === test.category) &&
        `${test.name} ${test.label} ${test.category}`
          .toLowerCase()
          .includes(this.query().trim().toLowerCase()),
    ),
  );
  protected toggleDetails(name: string): void {
    this.expanded.update((current) => (current === name ? '' : name));
  }
  protected showBookingNotice(): void {
    this.notice.set(
      'Website bookings are not open yet. Online sign-in, collection availability and report access will be available after the website is connected to Forum’s API.',
    );
  }
}
