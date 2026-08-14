import { randomUUID } from 'crypto';
import { Controller, Post, Body, BadRequestException, UseGuards, Req } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiBody } from '@nestjs/swagger';
import { AiService } from './ai.service';
// import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'; // Assuming standard Guard

@ApiTags('AI Clerk')
@Controller('ai/clerk')
export class AiClerkController {
    constructor(private readonly aiService: AiService) { }

    @Post('chat')
    // @UseGuards(JwtAuthGuard) // Enable when ready for auth
    // @ApiBearerAuth()
    @ApiOperation({ summary: 'Chat com o Balconista Virtual (RAG)' })
    @ApiBody({
        schema: {
            type: 'object',
            properties: {
                userId: { type: 'string', example: '6758d9...' },
                question: { type: 'string', example: 'Qual óleo serve no meu carro?' },
                image: { type: 'string', description: 'Base64 image string', example: '/9j/4AAQSw...' },
                vehicleId: { type: 'string', description: 'Veículo ativo no GarageContext do cliente (logado ou anônimo)' },
                vehicleLabel: { type: 'string', description: 'Rótulo do veículo ativo, ex: "Jeep Compass 2.0 2022"' },
                sessionId: { type: 'string', description: 'Identificador da conversa, gerado pelo cliente para manter histórico entre turnos' }
            }
        }
    })
    @ApiResponse({ status: 200, description: 'Resposta do Balconista Virtual' })
    async chat(@Body() body: { userId: string; question: string; image?: string; vehicleId?: string; vehicleLabel?: string; sessionId?: string }) {
        if (!body.question && !body.image) {
            throw new BadRequestException('Pergunta ou Imagem obrigatória');
        }
        // In production, get userId from @Req() user
        const userId = body.userId || ('' as string);
        const sessionId = body.sessionId || randomUUID();

        return this.aiService.virtualClerk(userId, body.question || '', body.image, {
            vehicleId: body.vehicleId,
            vehicleLabel: body.vehicleLabel,
        }, sessionId);
    }
}
