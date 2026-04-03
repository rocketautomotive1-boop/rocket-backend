import { Controller, Get, Post, Body, Param, Query, Logger } from '@nestjs/common';
import { QuestionsService } from './questions.service';

@Controller('questions')
export class QuestionsController {
    private readonly logger = new Logger(QuestionsController.name);

    constructor(private readonly questionsService: QuestionsService) { }

    @Get()
    async findAll(@Query() query: {
        status?: 'UNANSWERED' | 'ANSWERED';
        marketplaceId?: string;
        search?: string;
        sort?: string;
        order?: 'asc' | 'desc';
        limit?: number;
        offset?: number;
    }) {
        this.logger.log(`GET /questions - ${JSON.stringify(query)}`);
        return this.questionsService.findAll(query);
    }

    @Get('stats')
    async getStats() {
        return this.questionsService.getStats();
    }

    @Get(':id/ai-suggestion')
    async getAiSuggestion(@Param('id') id: string) {
        this.logger.log(`GET /questions/${id}/ai-suggestion`);
        return this.questionsService.getAiSuggestion(id);
    }

    @Post(':id/answer')
    async answer(@Param('id') id: string, @Body() body: { text: string; aiSuggestionUsed?: boolean }) {
        this.logger.log(`POST /questions/${id}/answer`);
        return this.questionsService.answerQuestion(id, body.text, body.aiSuggestionUsed);
    }

    @Post('sync')
    async sync() {
        this.logger.log('POST /questions/sync - Starting Manual Sync');
        try {
            const result = await this.questionsService.syncQuestions();
            this.logger.log('Sync completed successfully');
            return result;
        } catch (error) {
            this.logger.error(`Sync failed: ${error.message}`, error.stack);
            throw error;
        }
    }
}
