require "roo"

xlsx = Roo::Spreadsheet.open("LIST-20210923.xlsx")
sheet = xlsx.sheet(0)

first_row = 1
last_row = sheet.last_row
# last_row = 100

parsed_cases = []

(first_row..last_row).each do |row_index|

	complex_area = sheet.cell(row_index, 1)
	if complex_area.nil?
		# Move back 2: 
		# - 1 because row_index starts at 1, not 0
		# - 1 to move back to previous array item
		complex_area = parsed_cases[row_index-2][:complex_area]
	end

	school = sheet.cell(row_index, 2)
	if school.nil?
		school = parsed_cases[row_index-2][:school]
	end

	date_reported = sheet.cell(row_index, 3)
	if date_reported.nil?
		date_reported = parsed_cases[row_index-2][:date_reported]
	end

	last_date_on_campus = sheet.cell(row_index, 4)
	island = sheet.cell(row_index, 5)
	count = sheet.cell(row_index, 6)

	if (island =~ /\n/ && count =~ /\n/)
		# PDF parsed incorrectly and row needs to be manually split
		split_islands = island.split("\n")
		split_count = count.split("\n")

		if split_islands.count != split_count.count
			puts "Mismatch in split: row #{row_index}"
		end

		split_islands.count.times do |split_index|
			theCase = {
				complex_area: complex_area,
				school: school,
				date_reported: date_reported,
				last_date_on_campus: last_date_on_campus,
				island: split_islands[split_index],
				count: split_count[split_index].to_i
			}
			parsed_cases << theCase
		end
	else
		# Normal, expected circumstance
		theCase = {
			complex_area: complex_area,
			school: school,
			date_reported: date_reported,
			last_date_on_campus: last_date_on_campus,
			island: island,
			count: count.to_i
		}
		parsed_cases << theCase
	end

end

pp parsed_cases

grand_total = parsed_cases.sum{|c| c[:count] }
puts "Grand total: #{grand_total}"
