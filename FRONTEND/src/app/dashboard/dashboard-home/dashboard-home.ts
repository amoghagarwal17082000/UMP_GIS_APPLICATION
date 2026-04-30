import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { forkJoin } from 'rxjs';
import { Api } from 'src/app/api/api';
import { CurrentUserService } from 'src/app/services/current-user';

type CardType = 'TOTAL' | 'MAKER' | 'CHECKER' | 'APPROVER' | 'FINALIZED';

interface MainCard {
  key: CardType;
  title: string;
  value: number;
  color: string;
}

type EditableLayerKey =
  | 'stations'
  | 'km_post'
  | 'landplan_ontrack'
  | 'land_offset'
  | 'bridge_start'
  | 'bridge_end'
  | 'bridge_minor'
  | 'levelxing'
  | 'road_over_bridge'
  | 'rub_lhs'
  | 'ror';

interface SubCard {
  title: string;
  value: number;
  layerKey: string;
  statusKey: string;
}

@Component({
  selector: 'app-dashboard-home',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './dashboard-home.html',
  styleUrl: './dashboard-home.css',
})
export class DashboardHome implements OnInit {
  selectedMain: CardType = 'TOTAL';

  mainCards: MainCard[] = [
    { key: 'TOTAL', title: 'TOTAL', value: 0, color: 'blue' },
    { key: 'MAKER', title: 'MAKER', value: 0, color: 'pink' },
    { key: 'CHECKER', title: 'CHECKER', value: 0, color: 'green' },
    { key: 'APPROVER', title: 'APPROVER', value: 0, color: 'yellow' },
    { key: 'FINALIZED', title: 'FINALIZED', value: 0, color: 'teal' },
  ];

  subCardMap: Record<CardType, SubCard[]> = {
    TOTAL: this.emptySubCards('TOTAL'),
    MAKER: this.emptySubCards('MAKER'),
    CHECKER: this.emptySubCards('CHECKER'),
    APPROVER: this.emptySubCards('APPROVER'),
    FINALIZED: this.emptySubCards('FINALIZED'),
  };

  constructor(
    private api: Api,
    private cdr: ChangeDetectorRef,
    private router: Router,
    private currentUser: CurrentUserService
  ) {}

  private getUserMainKey(): CardType | 'ADMIN' | null {
    const ut = (this.currentUser.getSnapshot()?.user_type || '').trim().toLowerCase();
    if (ut === 'maker') return 'MAKER';
    if (ut === 'checker') return 'CHECKER';
    if (ut === 'approver') return 'APPROVER';
    if (ut === 'admin') return 'ADMIN';
    return null;
  }

  onSubCardClick(card: SubCard): void {
    if (card.layerKey !== 'stations') return;

    const userMain = this.getUserMainKey();
    if (!userMain) return;

    const allowed = userMain === 'ADMIN' || this.selectedMain === userMain;
    if (!allowed) return;

    this.router.navigate(['/dashboard/railway-assets'], {
      queryParams: {
        panel: 'edit',
        layer: 'stations',
      },
    });
  }

  ngOnInit(): void {
    this.loadDashboard();
  }

  private loadDashboard(): void {
    const types: CardType[] = ['TOTAL', 'MAKER', 'CHECKER', 'APPROVER', 'FINALIZED'];

    const stationCalls: any = {};
    const bridgeStartCalls: any = {};
    const bridgeStopCalls: any = {};
    const bridgeMinorCalls: any = {};
    const levelXingCalls: any = {};
    const robCalls: any = {};
    const rubLhsCalls: any = {};
    const rorCalls: any = {};
    const kmPostCalls: any = {};
    const landPlanCalls: any = {};

    types.forEach((type) => {
      stationCalls[type] = this.api.getStationCount(type);
      bridgeStartCalls[type] = this.api.getBridgeStartCount(type);
      bridgeStopCalls[type] = this.api.getBridgeStopCount(type);
      bridgeMinorCalls[type] = this.api.getBridgeMinorCount(type);
      levelXingCalls[type] = this.api.getLevelXingCount(type);
      robCalls[type] = this.api.getRoadOverBridgeCount(type);
      rubLhsCalls[type] = this.api.getRubLhsCount(type);
      rorCalls[type] = this.api.getRorCount(type);
      kmPostCalls[type] = this.api.getKmPostCount(type);
      landPlanCalls[type] = this.api.getLandPlanCount(type);
    });

    forkJoin({
      stations: forkJoin(stationCalls),
      bridgeStart: forkJoin(bridgeStartCalls),
      bridgeStop: forkJoin(bridgeStopCalls),
      bridgeMinor: forkJoin(bridgeMinorCalls),
      levelXing: forkJoin(levelXingCalls),
      rob: forkJoin(robCalls),
      rubLhs: forkJoin(rubLhsCalls),
      ror: forkJoin(rorCalls),
      kmPost: forkJoin(kmPostCalls),
      landPlan: forkJoin(landPlanCalls),
    }).subscribe({
      next: (res: any) => {
        types.forEach((type) => {
          this.setSubCard(type, 'Station', res.stations[type].count);
          this.setSubCard(type, 'Bridge Start', res.bridgeStart[type].count);
          this.setSubCard(type, 'Bridge Stop', res.bridgeStop[type].count);
          this.setSubCard(type, 'Bridge Minor', res.bridgeMinor[type].count);
          this.setSubCard(type, 'Level Xing', res.levelXing[type].count);
          this.setSubCard(type, 'Road Over Bridge', res.rob[type].count);
          this.setSubCard(type, 'Road Under Bridge', res.rubLhs[type].count);
          this.setSubCard(type, 'Rail Over Rail', res.ror[type].count);
          this.setSubCard(type, 'KM Post', res.kmPost[type].count);
          this.setSubCard(type, 'Land Plan Ontrack', res.landPlan[type].count);
        });

        this.selectedMain = 'TOTAL';
        this.cdr.detectChanges();
      },
      error: (err) => console.error('Dashboard load failed', err),
    });
  }

  private setSubCard(type: CardType, title: string, value: number): void {
    this.subCardMap = {
      ...this.subCardMap,
      [type]: this.subCardMap[type].map((c) => (c.title === title ? { ...c, value } : c)),
    };
    this.updateMain(type);
  }

  private updateMain(type: CardType): void {
    const sum = this.subCardMap[type].reduce((a, b) => a + b.value, 0);
    this.mainCards = this.mainCards.map((c) => (c.key === type ? { ...c, value: sum } : c));
  }

  onMainCardClick(key: CardType): void {
    this.selectedMain = key;
  }

  get activeSubCards(): SubCard[] {
    return this.subCardMap[this.selectedMain];
  }

  get activeColor(): string | undefined {
    return this.mainCards.find((c) => c.key === this.selectedMain)?.color;
  }

  private emptySubCards(statusKey: string): SubCard[] {
    return [
      { title: 'KM Post', value: 0, layerKey: 'km_post', statusKey },
      { title: 'Road Over Bridge', value: 0, layerKey: 'road_over_bridge', statusKey },
      { title: 'Rail Over Rail', value: 0, layerKey: 'ror', statusKey },
      { title: 'Road Under Bridge', value: 0, layerKey: 'rub_lhs', statusKey },
      { title: 'Station', value: 0, layerKey: 'stations', statusKey },
      { title: 'Level Xing', value: 0, layerKey: 'levelxing', statusKey },
      { title: 'Bridge Start', value: 0, layerKey: 'bridge_start', statusKey },
      { title: 'Bridge Stop', value: 0, layerKey: 'bridge_end', statusKey },
      { title: 'Bridge Minor', value: 0, layerKey: 'bridge_minor', statusKey },
      { title: 'Land Plan Ontrack', value: 0, layerKey: 'landplan_ontrack', statusKey },
    ];
  }
}
