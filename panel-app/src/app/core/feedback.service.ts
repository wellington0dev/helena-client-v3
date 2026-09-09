import { HttpClient } from "@angular/common/http";
import { Injectable, inject } from "@angular/core";
import { firstValueFrom } from "rxjs";

export type FeedbackCategory = "bug" | "suggestion";

export interface SubmitFeedbackInput {
    category: FeedbackCategory;
    message: string;
}

/** Consome `FeedbackController` (backend-v2, `src/feedback/feedback.controller.ts`) — relato voluntário de bug/sugestão, sem gate de consentimento (diferente de telemetria). */
@Injectable({ providedIn: "root" })
export class FeedbackService {
    private readonly http = inject(HttpClient);

    submit(input: SubmitFeedbackInput): Promise<{ id: string }> {
        return firstValueFrom(this.http.post<{ id: string }>("/feedback", { ...input, source: "panel" }));
    }
}
