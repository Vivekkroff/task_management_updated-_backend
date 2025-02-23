import express, { Request, Response } from 'express';
import ProjectEmployee from '../db/models/Tbl_ProjectEmployee';
import Employee from '../db/models/Tbl_Employee';
import Role from '../db/models/Tbl_Role';
import Project from '../db/models/Tbl_Project';
import { authenticateManager } from '../middleware/authenticateManager';
import { Op } from 'sequelize';


const projectEmployeeRoutes = express.Router();


projectEmployeeRoutes.post('/:projectId', async (req: any, res: any) => {
    const projectIdString = req.params.projectId; // Get Project_Id from URL parameters
    const { Emp_Id, Role_Id, Degesination } = req.body; // Get Emp_Id, Role_Id, and Degesination from request body

    try {
        // Validate input data
        if (!Emp_Id || !Role_Id || !Degesination) {
            return res.status(400).json({
                success: false,
                message: 'Emp_Id, Role_Id, and Degesination are required.',
            });
        }

        // Convert Project_Id to a number
        const projectIdNumber = Number(projectIdString);

        // Check if the employee exists
        const employee = await Employee.findByPk(Emp_Id);
        if (!employee) {
            return res.status(404).json({
                success: false,
                message: 'Employee not found.',
            });
        }

        // Check if the ProjectEmployee record already exists
        const existingProjectEmployee = await ProjectEmployee.findOne({
            where: {
                Project_Id: projectIdNumber,
                Emp_Id: Emp_Id,
                Is_deleted: false
            },
        });

        if (existingProjectEmployee) {
            // If the ProjectEmployee exists, return an error
            return res.status(409).json({
                success: false,
                message: 'Employee is already assigned to this project.',
            });
        }

        // Check if the employee is already a team lead in any project
        if (Role_Id === 2) { // Check for Team_Lead role
            // Check if there's already a team lead with the same designation for the project
            const existingTeamLead = await ProjectEmployee.findOne({
                where: {
                    Project_Id: projectIdNumber,
                    Role_Id: 2, // Check specifically for team lead role
                    Degesination, // Ensure designation matches
                    Is_deleted: false
                },
            });

            if (existingTeamLead) {
                // If a team lead with the same designation already exists for this project, return an error
                return res.status(409).json({
                    success: false,
                    message: `A team lead with the designation '${Degesination}' already exists for this project.`,
                });
            }
        }

        // Create a new ProjectEmployee record
        const newProjectEmployee = await ProjectEmployee.create({
            Project_Id: projectIdNumber,
            Emp_Id, // Use Emp_Id from request body
            Role_Id,
            Degesination,
            Is_deleted: false,
        });

        // Update the employee's role only if they are being added as a team lead
        if (Role_Id === 2) {
            // Update the employee's role only if they are being assigned as a team lead
            await Employee.update(
                { Role_Id }, // Set new Role_Id from request body
                { where: { Emp_Id } } // Find employee by Emp_Id
            );
        }

        return res.status(201).json({
            success: true,
            message: 'Project employee created successfully.',
            data: newProjectEmployee,
        });
    } catch (error: any) {
        return res.status(500).json({
            success: false,
            message: 'Failed to create the project employee',
            error: error.message,
        });
    }
});
//patch 

projectEmployeeRoutes.patch('/:projectId/:projectMemberId', authenticateManager, async (req: any, res: any) => {
    const { projectId, projectMemberId } = req.params;
    const { Emp_Id, Role_Id, Degesination } = req.body;

    try {
        console.log('Request received to update ProjectEmployee:', { projectId, projectMemberId, Emp_Id, Role_Id, Degesination });

        // Validate input data
        if (!Emp_Id || !Role_Id || !Degesination) {
            console.error('Validation error: Missing required fields');
            return res.status(400).json({
                success: false,
                message: 'Emp_Id, Role_Id, and Degesination are required.',
            });
        }

        // Find the existing ProjectEmployee record
        const projectEmployee = await ProjectEmployee.findOne({
            where: {
                ProjectMember_Id: projectMemberId,
                Project_Id: projectId,
                Is_deleted: false,
            },
        });

        if (!projectEmployee) {
            console.warn('ProjectEmployee record not found:', { projectMemberId, projectId });
            return res.status(404).json({
                success: false,
                message: 'ProjectEmployee record not found.',
            });
        }

        console.log('Found ProjectEmployee record:', projectEmployee);

        // Check if an employee is already a team lead in another project
        if (Role_Id === 2) { // Team Lead role
            const existingTeamLeadProject = await ProjectEmployee.findOne({
                where: {
                    Emp_Id,
                    Role_Id: 2, // Team Lead role
                    Project_Id: { [Op.ne]: projectId }, // Check other projects
                    Is_deleted: false,
                },
            });

            if (existingTeamLeadProject) {
                console.warn('Conflict: Employee is already a team lead in another project:', existingTeamLeadProject);
                return res.status(409).json({
                    success: false,
                    message: `Employee is already a team lead in another project (Project ID: ${existingTeamLeadProject.Project_Id}).`,
                });
            }

            // Check if there's already a team lead for this designation within the same project
            const existingDesignationTeamLead = await ProjectEmployee.findOne({
                where: {
                    Project_Id: projectId,
                    Role_Id: 2, // Team Lead role
                    Degesination, // Same designation
                    Is_deleted: false,
                },
            });

            if (existingDesignationTeamLead && existingDesignationTeamLead.ProjectMember_Id !== Number(projectMemberId)) {
                console.warn('Conflict: A team lead with the same designation already exists:', existingDesignationTeamLead);
                return res.status(409).json({
                    success: false,
                    message: `A team lead with the designation '${Degesination}' already exists for this project.`,
                });
            }
        }

        // Update the ProjectEmployee record using the update method
        const [updated] = await ProjectEmployee.update(
            { Emp_Id, Role_Id, Degesination },
            { where: { ProjectMember_Id: projectMemberId, Project_Id: projectId, Is_deleted: false } }
        );

        if (updated === 0) {
            console.warn('Update failed: No rows affected');
            return res.status(404).json({
                success: false,
                message: 'Update failed: No rows affected.',
            });
        }

        console.log('ProjectEmployee updated successfully:', { Emp_Id, Role_Id, Degesination });

        // If the role is being updated, also update the role in the Employee table
        if (projectEmployee.Role_Id !== Role_Id) {
            if (Role_Id === 2) { // Team Lead role
                await Employee.update(
                    { Role_Id },
                    { where: { Emp_Id } }
                );
            } else if (projectEmployee.Role_Id === 2 && Role_Id !== 2) {
                // If the role is downgraded from team lead to member, update the Employee role accordingly
                await Employee.update(
                    { Role_Id: 3 }, // Assuming '3' is the default member role
                    { where: { Emp_Id } }
                );
            }
        }

        return res.status(200).json({
            success: true,
            message: 'ProjectEmployee updated successfully.',
            data: { Emp_Id, Role_Id, Degesination }, // Return updated data if needed
        });
    } catch (error: any) {
        console.error('Error occurred while updating ProjectEmployee:', error.message);
        return res.status(500).json({
            success: false,
            message: 'Failed to update the project employee',
            error: error.message,
        });
    }
});












// Get API

projectEmployeeRoutes.get('/:projectId', authenticateManager, async (req: any, res: any) => {
    const projectIdString = req.params.projectId;
    const page = parseInt(req.query.page) || 1;
    const pageSize = parseInt(req.query.pageSize) || 5;
    const searchTerm = req.query.search || '';

    try {
        const projectIdNumber = Number(projectIdString);

        // Set up the base query
        const whereClause: any = {
            Project_Id: projectIdNumber,
            Is_deleted: false,
        };

        // Employee and Role search filters (only if searchTerm is provided)
        const employeeWhereClause: any = {};
        const roleWhereClause: any = {};

        if (searchTerm) {
            employeeWhereClause.Employee_name = {
                [Op.iLike]: `%${searchTerm}%`,  // Use case-insensitive search for employee names
            };

            // roleWhereClause.Name = {
            //     [Op.iLike]: `%${searchTerm}%`,  // Use case-insensitive search for role names
            // };
        }

        // Fetch project employees by Project_Id with search and pagination
        const projectEmployees = await ProjectEmployee.findAndCountAll({
            where: whereClause,
            include: [
                {
                    model: Employee,
                    attributes: ['Employee_name', 'Role_Id'],
                    where: employeeWhereClause,  // Apply employee search condition
                    include: [
                        {
                            model: Role,
                            attributes: ['Name'],
                            as: 'Role',
                            where: roleWhereClause,  // Apply role search condition
                        },
                    ],
                },
                {
                    model: Project,
                    attributes: ['Project_Name'],
                },
            ],
            offset: (page - 1) * pageSize,
            limit: pageSize,
        });

        // Map the response to include Employee_name, Role_Name, and Project_Name
        const response = projectEmployees.rows.map((projectEmployee) => ({
            ProjectMember_Id: projectEmployee.ProjectMember_Id,
            Project_Id: projectEmployee.Project_Id,
            Emp_Id: projectEmployee.Emp_Id,
            Employee_name: projectEmployee.Employee?.Employee_name,
            Role_Id: projectEmployee.Employee?.Role_Id,
            Role_Name: projectEmployee.Employee?.Role?.Name,
            Degesination: projectEmployee.Degesination,
            Project_Name: projectEmployee.Project?.Project_Name,
            Is_deleted: projectEmployee.Is_deleted,
        }));

        // Calculate total pages and return response
        return res.status(200).json({
            success: true,
            data: response,
            total: projectEmployees.count,
            totalPages: Math.ceil(projectEmployees.count / pageSize),
            currentPage: page,
        });
    } catch (error: any) {
        return res.status(500).json({
            success: false,
            message: 'Failed to retrieve project employees',
            error: error.message,
        });
    }
});



export default projectEmployeeRoutes;
