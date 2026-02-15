import { Controller, Get, Post, Body, Param, Query, Logger } from '@nestjs/common';
import { QuestionsService } from './questions.service';

@Controller('questions')
export class QuestionsController {
    private readonly logger = new Logger(QuestionsController.name);

    constructor(private readonly questionsService: QuestionsService) { }

    @Get()
    async findAll(@Query() query: { status?: 'UNANSWERED' | 'ANSWERED'; marketplaceId?: string; limit?: number; offset?: number }) {
        this.logger.log(`GET /questions - ${JSON.stringify(query)}`);
        return this.questionsService.findAll(query);
    }

    @Post(':id/answer')
    async answer(@Param('id') id: string, @Body() body: { text: string }) {
        this.logger.log(`POST /questions/${id}/answer`);
        return this.questionsService.answerQuestion(id, body.text);
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
