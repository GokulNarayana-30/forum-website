import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule, NgForm } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Address } from '../core/models';
import { WebsiteStore } from '../core/store';
import { AddressPicker, PickedLocation } from './address-picker';

type Section = 'profile' | 'family' | 'addresses' | 'support';
@Component({
  selector: 'forum-account',
  imports: [FormsModule, RouterLink, AddressPicker],
  templateUrl: './account.html',
  styleUrl: './account.scss',
})
export class Account {
  protected readonly store = inject(WebsiteStore);
  protected readonly section = signal<Section>('profile');
  protected readonly editing = signal(false);
  /** The saved address being changed, or null while a new one is added. */
  protected readonly editingAddressId = signal<string | null>(null);
  protected readonly saved = signal('');
  protected readonly saveError = signal('');
  protected readonly family = computed(() =>
    this.store.people().filter((person) => person.relation !== 'self' && person.id !== 'me'),
  );
  protected readonly initials = computed(() =>
    (this.store.profile()?.name || 'Your account')
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0])
      .join('')
      .toUpperCase(),
  );
  protected readonly sections: { id: Section; title: string; hint: string; icon: string }[] = [
    {
      id: 'profile',
      title: 'Personal details',
      hint: 'Your information for collections',
      icon: 'M20 21v-2a7 7 0 0 0-14 0v2M17 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
    },
    {
      id: 'family',
      title: 'Family members',
      hint: 'People you book care for',
      icon: 'M16 21v-2a6 6 0 0 0-12 0v2M14 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0M19 4a4 4 0 0 1 0 8M22 21v-2a6 6 0 0 0-4-5',
    },
    {
      id: 'addresses',
      title: 'Saved addresses',
      hint: 'Where we collect your samples',
      icon: 'M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0M15 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
    },
    {
      id: 'support',
      title: 'Privacy & help',
      hint: 'Information and support',
      icon: 'M12 22S3 18 3 10V4l9-3 9 3v6c0 8-9 12-9 12M8 11l3 3 5-6',
    },
  ];
  protected profileForm = { name: '', dob: '', gender: '', phone: '' };
  protected familyForm = this.emptyFamily();
  protected addressForm = this.emptyAddress();
  constructor() {
    effect(() => {
      if (!this.store.signedIn())
        untracked(() => {
          this.section.set('profile');
          this.editing.set(false);
          this.saved.set('');
          this.saveError.set('');
          this.profileForm = { name: '', dob: '', gender: '', phone: '' };
          this.familyForm = this.emptyFamily();
          this.addressForm = this.emptyAddress();
          this.editingAddressId.set(null);
        });
    });
  }
  protected label(value?: string): string {
    if (!value) return 'Not added';
    return value.charAt(0).toUpperCase() + value.slice(1).replaceAll('_', ' ');
  }
  protected birthDate(value?: string): string {
    if (!value) return 'Not added';
    const [year, month, day] = value.split('-');
    return `${day} / ${month} / ${year}`;
  }
  protected select(section: Section): void {
    this.section.set(section);
    this.editing.set(false);
    this.saved.set('');
    this.saveError.set('');
  }
  protected edit(): void {
    const profile = this.store.profile();
    this.profileForm = {
      name: profile?.name ?? '',
      dob: profile?.date_of_birth ?? '',
      gender: profile?.gender ?? '',
      phone: profile?.phone ?? '',
    };
    this.familyForm = this.emptyFamily();
    this.addressForm = this.emptyAddress();
    this.editingAddressId.set(null);
    this.saved.set('');
    this.saveError.set('');
    this.editing.set(true);
  }
  /** Opens a saved address for changing. Its pin is not stored here, so the form starts without one. */
  protected editAddress(address: Address): void {
    this.addressForm = {
      ...this.emptyAddress(),
      type: address.type,
      house: address.house,
      street: address.street ?? '',
      area: address.area,
      pincode: address.pincode,
      landmark: address.landmark ?? '',
      access_notes: address.access_notes ?? '',
    };
    this.editingAddressId.set(address.id);
    this.saved.set('');
    this.saveError.set('');
    this.editing.set(true);
  }
  protected async save(form: NgForm): Promise<void> {
    if (!form.valid || this.store.preview() || !this.store.canEdit()) return;
    this.saveError.set('');
    const section = this.section();
    if (section === 'profile') {
      const p = this.profileForm;
      await this.store.saveProfile(p.name, p.dob, p.gender, p.phone);
    } else if (section === 'family') await this.store.addFamily(this.familyForm);
    else if (section === 'addresses') {
      // The pin's coordinates travel only as a pair, and only while the address still matches it.
      const { latitude, longitude, ...address } = this.addressForm;
      const body = latitude !== null && longitude !== null ? { ...address, latitude, longitude } : address;
      const id = this.editingAddressId();
      if (id) await this.store.updateAddress(id, body);
      else await this.store.addAddress(body);
    } else return;
    if (this.store.error()) this.saveError.set(this.store.error());
    else if (this.store.signedIn()) {
      this.editing.set(false);
      this.saved.set(
        section === 'profile'
          ? 'Your details have been saved.'
          : section === 'family'
            ? 'Family member added.'
            : this.editingAddressId()
              ? 'Address saved.'
              : 'Address added.',
      );
    }
  }
  /** Fills the address form from a place the customer found; house or flat stays theirs to type. */
  protected applyLocation(place: PickedLocation): void {
    const form = this.addressForm;
    form.street = place.street || form.street;
    form.area = place.area || form.area;
    form.pincode = place.pincode;
    if (place.landmark && !form.landmark) form.landmark = place.landmark;
    form.latitude = place.latitude;
    form.longitude = place.longitude;
  }
  /** A pincode typed by hand no longer matches the picked pin, so the pin's coordinates are dropped. */
  protected clearCoordinates(): void {
    this.addressForm.latitude = null;
    this.addressForm.longitude = null;
  }
  private emptyFamily() {
    return {
      name: '',
      relation: 'spouse',
      date_of_birth: '',
      gender: '',
      share_consent: false,
      guardian_confirmed: false,
    };
  }
  private emptyAddress() {
    return {
      type: 'home',
      house: '',
      street: '',
      area: '',
      pincode: '',
      landmark: '',
      access_notes: '',
      latitude: null as number | null,
      longitude: null as number | null,
    };
  }
}
