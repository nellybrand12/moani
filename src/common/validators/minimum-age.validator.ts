import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';

/**
 * @MinimumAge(n) — validates that a ISO date string represents a person who is
 * at least `n` years old as of today.
 *
 * Age is computed correctly across leap years and birthdays:
 * we compare the calendar date, not just the year difference.
 *
 * Apply to a string field decorated with @IsDateString().
 *
 * @example
 *   @IsDateString()
 *   @MinimumAge(18)
 *   dateOfBirth: string;
 */
export function MinimumAge(
  minAge: number,
  validationOptions?: ValidationOptions,
) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'minimumAge',
      target: (
        object as { constructor: abstract new (...args: unknown[]) => unknown }
      ).constructor,
      propertyName,
      options: validationOptions,
      constraints: [minAge],
      validator: {
        validate(value: unknown, args: ValidationArguments): boolean {
          if (typeof value !== 'string') return false;

          const dob = new Date(value);
          if (isNaN(dob.getTime())) return false;

          const today = new Date();

          // Compute how many full years have passed
          let age = today.getFullYear() - dob.getFullYear();

          // Roll back one year if the birthday hasn't occurred yet this year
          const hasHadBirthdayThisYear =
            today.getMonth() > dob.getMonth() ||
            (today.getMonth() === dob.getMonth() &&
              today.getDate() >= dob.getDate());

          if (!hasHadBirthdayThisYear) {
            age -= 1;
          }

          const [requiredAge] = args.constraints as [number];
          return age >= requiredAge;
        },

        defaultMessage(args: ValidationArguments): string {
          const [requiredAge] = args.constraints as [number];
          return `${args.property} must be at least ${requiredAge} years ago`;
        },
      },
    });
  };
}
